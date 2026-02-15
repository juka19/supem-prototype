"""
Sankey computation: decomposes supply chain emissions into tiered flows.

Based on the OECD methodology (Yamano, Lioussis, Cimper 2024):

Upstream (S3U): Leontief tier decomposition of indirect emissions.
  EF = S1 / X   (emission factor: direct emissions per unit output)
  eB = diag(EF) * B  where B = (I-A)^{-1}  (Leontief inverse)
  Tier k emissions from supplier i = EF_i * [A^k * e_f * X_f]_i
  Total S3U = u * eB_i * X_i - S1_i - S2_i

  The tier decomposition visualizes which supplier industries/countries
  contribute emissions at each production stage. Node values are scaled
  so the root total matches the DF_SCOPE S3U value for the focus industry.

Downstream (S3D): Output allocation via Ghosh model (approximation).
  The paper defines S3D as distribution margin emissions:
    S3D = u * eB * (Z_m * u + F_m * u)
  where Z_m + F_m are the distribution margins from ICIO compilation.
  Since those margin matrices are not available in the raw ICIO CSVs,
  we approximate downstream flows using the Ghosh output allocation
  model: B_out = diag(x)^{-1} * Z, trace forward via B_out^T.
  Node values are scaled to match the DF_SCOPE S3D total.
"""

import numpy as np
import os
import yaml


def _load_lookups():
    """Load country and sector label mappings from config."""
    config_dir = os.path.join(os.path.dirname(__file__), '..', 'config')
    with open(os.path.join(config_dir, 'countries.yaml')) as f:
        countries = yaml.safe_load(f)['countries']
    with open(os.path.join(config_dir, 'sectors.yaml')) as f:
        sectors = yaml.safe_load(f)['sectors']
    return countries, sectors


def _make_node_label(iso3, isic, countries, sectors):
    """Build a human-readable label like 'Germany - Motor vehicles'."""
    c = countries.get(iso3, iso3)
    s = sectors.get(isic, isic)
    return f'{c} \u2013 {s}'


def _aggregate_to_top_k(flow_list, top_k=10, min_share=0.005):
    """
    Keep top K entries by value, aggregate the rest into 'Other'.

    Parameters
    ----------
    flow_list : list[tuple]
        Each tuple: (node_idx, iso3, isic, value)
    top_k : int
    min_share : float

    Returns
    -------
    list[tuple] — filtered list; 'Other' entries use idx=-1, iso3='OTHER'
    """
    if not flow_list:
        return []

    total = sum(v for _, _, _, v in flow_list)
    if total <= 0:
        return []

    sorted_flows = sorted(flow_list, key=lambda x: x[3], reverse=True)

    kept = []
    other_value = 0.0

    for i, (idx, iso3, isic, val) in enumerate(sorted_flows):
        share = val / total
        if i < top_k and share >= min_share:
            kept.append((idx, iso3, isic, val))
        else:
            other_value += val

    if other_value > 0:
        kept.append((-1, 'OTHER', 'OTHER', other_value))

    return kept


def _compute_tiered_flows(A, g, x, labels, focus_idx, n_tiers, top_k,
                          min_share, countries_map, sectors_map, direction):
    """
    Generic tier-by-tier supply chain trace.

    For upstream: A is the technical coefficient matrix, trace backwards
    For downstream: A is the output coefficient matrix transposed, trace forwards

    Returns dict with nodes and links, where links connect tier N to tier N+1.
    """
    N = len(x)
    focus_label = labels[focus_idx]
    focus_iso3, focus_isic = focus_label[:3], focus_label[4:]

    all_nodes = []
    all_links = []

    root_id = f'{focus_iso3}|{focus_isic}'
    all_nodes.append({
        'id': root_id,
        'iso3': focus_iso3,
        'isic': focus_isic,
        'label': _make_node_label(focus_iso3, focus_isic, countries_map, sectors_map),
        'tier': 0,
    })

    # Track per-parent demand vectors for proper tier-to-tier linking.
    # parent_demands maps parent_node_id -> (demand_vector, parent_indices_set)
    # For tier 1: the only parent is the root node.
    parent_demands = {
        root_id: {
            'vector': _unit_vector(N, focus_idx) * x[focus_idx],
            'indices': {focus_idx},
        }
    }

    for tier in range(1, n_tiers + 1):
        # For each parent, compute what it demands from this tier
        parent_child_flows = {}  # parent_id -> list of (child_idx, iso3, isic, value)

        for parent_id, pdata in parent_demands.items():
            pv = pdata['vector']
            supply = A @ pv
            tier_emissions = g * supply

            flows = []
            for i in range(N):
                if tier_emissions[i] > 1e-10:
                    iso3_i = labels[i][:3]
                    isic_i = labels[i][4:]
                    flows.append((i, iso3_i, isic_i, float(tier_emissions[i])))

            parent_child_flows[parent_id] = flows

        # Aggregate ALL flows at this tier level (across all parents) to determine
        # which nodes to keep. First, sum by destination node across all parents.
        total_by_dest = {}
        for parent_id, flows in parent_child_flows.items():
            for idx, iso3, isic, val in flows:
                key = (idx, iso3, isic)
                total_by_dest[key] = total_by_dest.get(key, 0.0) + val

        global_flow_list = [(idx, iso3, isic, val)
                            for (idx, iso3, isic), val in total_by_dest.items()]
        kept = _aggregate_to_top_k(global_flow_list, top_k=top_k, min_share=min_share)

        # Determine which original indices got collapsed into "Other"
        kept_indices = set()
        for idx, iso3, isic, val in kept:
            if idx >= 0:
                kept_indices.add(idx)

        # Create nodes and links
        new_parent_demands = {}

        for idx, iso3, isic, val in kept:
            if iso3 == 'OTHER':
                node_id = f'OTHER_T{tier}'
                label = 'Other'
            else:
                node_id = f'{iso3}|{isic}_T{tier}'
                label = _make_node_label(iso3, isic, countries_map, sectors_map)

            all_nodes.append({
                'id': node_id,
                'iso3': iso3,
                'isic': isic,
                'label': label,
                'tier': tier,
                'value': round(val, 3),
            })

            # Create links from each parent to this child
            for parent_id, flows in parent_child_flows.items():
                link_val = 0.0
                for fi, fiso3, fisic, fval in flows:
                    if iso3 == 'OTHER':
                        # Sum all flows that aren't in kept_indices
                        if fi not in kept_indices:
                            link_val += fval
                    elif fi == idx:
                        link_val += fval

                if link_val > 1e-10:
                    all_links.append({
                        'source': parent_id,
                        'target': node_id,
                        'value': round(link_val, 3),
                    })

            # Build demand vector for this child (for next tier tracing)
            if idx >= 0:
                supply_vec = A @ _unit_vector(N, idx)
                new_parent_demands[node_id] = {
                    'vector': supply_vec * val / g[idx] if g[idx] > 0 else np.zeros(N),
                    'indices': {idx},
                }

        parent_demands = new_parent_demands

    # Set root value = sum of tier 1 link values
    tier1_nodes = {n['id'] for n in all_nodes if n['tier'] == 1}
    root_value = sum(l['value'] for l in all_links if l['target'] in tier1_nodes)
    all_nodes[0]['value'] = round(root_value, 3)

    return {'nodes': all_nodes, 'links': all_links}


def _tag_groups(result):
    """
    Tag every node with a 'group' field:
      - 'root' for tier 0
      - 'domestic' for nodes with same iso3 as root
      - 'other' for OTHER aggregate nodes
      - 'foreign' for everything else
    """
    root_iso3 = result['nodes'][0]['iso3']
    for node in result['nodes']:
        if node['tier'] == 0:
            node['group'] = 'root'
        elif node['iso3'] == 'OTHER':
            node['group'] = 'other'
        elif node['iso3'] == root_iso3:
            node['group'] = 'domestic'
        else:
            node['group'] = 'foreign'
    return result


def _collapse_domestic(result, countries_map, max_collapse_tier=2):
    """
    Collapse individual domestic nodes at tiers 1..max_collapse_tier into
    a single aggregate 'Domestic' node per tier.

    Domestic = same iso3 as the root node.
    Links targeting/sourcing collapsed nodes are merged accordingly.
    Tier 3+ nodes are kept individually (only tagged, not collapsed).
    """
    root_iso3 = result['nodes'][0]['iso3']
    country_name = countries_map.get(root_iso3, root_iso3)
    nodes = result['nodes']
    links = result['links']

    for tier in range(1, max_collapse_tier + 1):
        # Find domestic nodes at this tier
        domestic_ids = set()
        domestic_value = 0.0
        for n in nodes:
            if n['tier'] == tier and n['iso3'] == root_iso3:
                domestic_ids.add(n['id'])
                domestic_value += n.get('value', 0)

        if not domestic_ids:
            continue

        # Create the aggregate domestic node
        agg_id = f'DOMESTIC_T{tier}'
        agg_node = {
            'id': agg_id,
            'iso3': root_iso3,
            'isic': 'DOMESTIC',
            'label': f'{country_name} \u2013 Domestic sectors',
            'tier': tier,
            'value': round(domestic_value, 3),
            'group': 'domestic',
        }

        # Remove individual domestic nodes
        nodes = [n for n in nodes if n['id'] not in domestic_ids]
        nodes.append(agg_node)

        # Redirect links targeting domestic nodes → target agg_id
        # Redirect links sourcing from domestic nodes → source agg_id
        merged_links = []
        link_map = {}  # (source, target) -> value

        for link in links:
            src = link['source']
            tgt = link['target']
            val = link['value']

            if tgt in domestic_ids:
                tgt = agg_id
            if src in domestic_ids:
                src = agg_id

            key = (src, tgt)
            link_map[key] = link_map.get(key, 0.0) + val

        links = [{'source': s, 'target': t, 'value': round(v, 3)}
                 for (s, t), v in link_map.items()]

    result['nodes'] = nodes
    result['links'] = links
    return result


def _scale_to_scope_total(result, scope_total):
    """
    Proportionally scale all node values and link values so the root
    total matches the DF_SCOPE scope value (S3U or S3D).

    This ensures the sankey visualization is consistent with the split
    bar chart, which shows the official DF_SCOPE scope values.
    """
    if scope_total is None or scope_total <= 0:
        return result

    root_value = result['nodes'][0].get('value', 0)
    if root_value <= 0:
        return result

    scale = scope_total / root_value

    for node in result['nodes']:
        if 'value' in node:
            node['value'] = round(node['value'] * scale, 3)

    for link in result['links']:
        link['value'] = round(link['value'] * scale, 3)

    return result


def _unit_vector(n, idx):
    """Create a unit vector of length n with 1 at position idx."""
    v = np.zeros(n)
    v[idx] = 1.0
    return v


def compute_upstream_tiers(icio, emissions_s1, focus_idx,
                           n_tiers=3, top_k=10, min_share=0.005,
                           scope_total=None):
    """
    Compute upstream supply chain emissions decomposition.

    Uses Leontief tier decomposition per the OECD methodology:
        A = Z * diag(x)^{-1}   (technical coefficients)
        EF = S1 / x            (emission factor: direct emissions per output)
        Tier k emissions from supplier i = EF_i * [A^k * e_focus * x_focus]_i

    The total is scaled to match the DF_SCOPE S3U value for the focus
    industry when scope_total is provided.

    Parameters
    ----------
    icio : dict
        Parsed ICIO data (Z, x, labels, etc.)
    emissions_s1 : np.ndarray
        S1 (direct/production-based) emissions vector for all industries.
    focus_idx : int
        Index of the focus industry in the ICIO arrays.
    n_tiers : int
        Number of supply chain tiers to trace.
    top_k : int
        Keep top K nodes per tier.
    min_share : float
        Minimum share threshold for keeping a node.
    scope_total : float, optional
        S3U value from DF_SCOPE for calibration. If provided, all values
        are scaled so the root total matches this.
    """
    Z = icio['Z']
    x = icio['x']
    labels = icio['labels']
    N = len(x)
    countries_map, sectors_map = _load_lookups()

    # Technical coefficients: A_ij = Z_ij / x_j
    x_inv = np.zeros(N)
    nonzero = x > 0
    x_inv[nonzero] = 1.0 / x[nonzero]
    A = Z * x_inv[np.newaxis, :]  # A[:,j] = Z[:,j] / x[j]

    # Emission intensity: EF = S1 / x
    g = np.zeros(N)
    g[nonzero] = emissions_s1[nonzero] / x[nonzero]

    result = _compute_tiered_flows(
        A, g, x, labels, focus_idx, n_tiers, top_k, min_share,
        countries_map, sectors_map, 'upstream'
    )

    result = _collapse_domestic(result, countries_map)
    result = _tag_groups(result)
    return _scale_to_scope_total(result, scope_total)


def compute_downstream_tiers(icio, emissions_s1, focus_idx,
                              n_tiers=3, top_k=10, min_share=0.005,
                              scope_total=None):
    """
    Compute downstream (output destination) emissions decomposition.

    The OECD paper defines S3D as distribution margin emissions:
        S3D = u * eB * (Z_m * u + F_m * u)
    requiring margin matrices from the ICIO compilation process.

    Since those matrices are not in the raw ICIO CSVs, this function
    uses the Ghosh output allocation model as an approximation:
        B_out = diag(x)^{-1} * Z   (output coefficients)
        B_out^T traces forward through demand chain.

    The total is scaled to match the DF_SCOPE S3D value for the focus
    industry when scope_total is provided.

    Parameters
    ----------
    icio : dict
        Parsed ICIO data (Z, x, labels, etc.)
    emissions_s1 : np.ndarray
        S1 (direct/production-based) emissions vector for all industries.
    focus_idx : int
        Index of the focus industry in the ICIO arrays.
    n_tiers : int
        Number of output tiers to trace.
    top_k : int
        Keep top K nodes per tier.
    min_share : float
        Minimum share threshold for keeping a node.
    scope_total : float, optional
        S3D value from DF_SCOPE for calibration. If provided, all values
        are scaled so the root total matches this.
    """
    Z = icio['Z']
    x = icio['x']
    labels = icio['labels']
    N = len(x)
    countries_map, sectors_map = _load_lookups()

    # Output coefficients: B_ij = Z_ij / x_i
    x_inv = np.zeros(N)
    nonzero = x > 0
    x_inv[nonzero] = 1.0 / x[nonzero]
    B_T = (Z * x_inv[:, np.newaxis]).T  # B^T for forward tracing

    # Emission intensity
    g = np.zeros(N)
    g[nonzero] = emissions_s1[nonzero] / x[nonzero]

    result = _compute_tiered_flows(
        B_T, g, x, labels, focus_idx, n_tiers, top_k, min_share,
        countries_map, sectors_map, 'downstream'
    )

    result = _collapse_domestic(result, countries_map)
    result = _tag_groups(result)
    return _scale_to_scope_total(result, scope_total)
