"""
Sankey layout: positions nodes with x/y/w/h coordinates for rendering.

Produces output matching the format consumed by SankeyLayer.js:
  nodes: [{id, label, tier, x, y, w, h, group}, ...]
  links: [{source, target, value}, ...]

Nodes are stacked vertically within each tier column, sorted by group
(domestic → foreign → other), then by value within each group.
Vertical gaps separate the domestic, foreign, and "other" groups.
"""


# Layout constants (in data coordinate units — the frontend applies its own scaling)
NODE_WIDTH = 18
TIER_SPACING = 220   # horizontal gap between tier columns
PAD_Y = 5            # vertical gap between nodes (tier 1)
PAD_Y_OUTER = 14     # vertical gap between nodes (tiers 2+)
PAD_X_START = 40     # left margin for tier 0
GROUP_GAP = 20       # vertical gap between domestic and foreign groups
OTHER_GAP = 25       # vertical gap before "Other" node


def layout_sankey(sankey_data, direction, max_tier):
    """
    Compute x/y/w/h layout for sankey nodes and produce tiered output files.

    Parameters
    ----------
    sankey_data : dict
        Output from compute_upstream_tiers or compute_downstream_tiers.
        Contains 'nodes' and 'links'.
    direction : str
        'upstream' or 'downstream'.
    max_tier : int
        Maximum tier in the data (typically 3).

    Returns
    -------
    dict keyed by tier level (1, 2, 3), each containing:
        {direction, root, tier, nodes, links, meta}
    matching the format of the existing frontend JSON files.
    """
    nodes = sankey_data['nodes']
    links = sankey_data['links']

    # Group nodes by tier
    by_tier = {}
    for n in nodes:
        t = n['tier']
        if t not in by_tier:
            by_tier[t] = []
        by_tier[t].append(n)

    # Sort each tier: domestic first, then foreign by value desc, then "other" last
    GROUP_ORDER = {'domestic': 0, 'foreign': 1, 'other': 2}
    for t in by_tier:
        by_tier[t] = sorted(
            by_tier[t],
            key=lambda n: (GROUP_ORDER.get(n.get('group', 'foreign'), 1),
                           -n.get('value', 0))
        )

    # Compute scale factor: find the tier with the largest total value
    # and make its nodes fill the available vertical space.
    max_tier_height = 0
    for t, tier_nodes in by_tier.items():
        if t == 0:
            continue  # root gets special treatment
        total_h = sum(n.get('value', 0) for n in tier_nodes)
        tier_pad = PAD_Y_OUTER if t >= 2 else PAD_Y
        total_h += tier_pad * max(0, len(tier_nodes) - 1)
        max_tier_height = max(max_tier_height, total_h)

    # Target height for the diagram (in data units)
    target_height = max(max_tier_height, 100)

    # Scale factor: map values to pixel heights
    max_tier_val = 0
    for t, tier_nodes in by_tier.items():
        if t == 0:
            continue
        total_val = sum(n.get('value', 0) for n in tier_nodes)
        if total_val > max_tier_val:
            max_tier_val = total_val

    if max_tier_val > 0:
        # Allow 90% of available height for nodes, rest for padding
        available_h = target_height * 0.9
        val_scale = available_h / max_tier_val
    else:
        val_scale = 1.0

    # Assign x, y, w, h to each node
    node_map = {}  # id -> node dict with layout

    for t, tier_nodes in by_tier.items():
        if t == 0:
            # Root node: centered vertically
            root = tier_nodes[0]
            root_val = root.get('value', 1)
            root_h = max(root_val * val_scale, 10)

            if direction == 'upstream':
                root_x = PAD_X_START + max_tier * TIER_SPACING
            else:
                root_x = PAD_X_START

            root_y = (target_height - root_h) / 2

            node_map[root['id']] = {
                **root,
                'x': round(root_x),
                'y': round(root_y),
                'w': NODE_WIDTH,
                'h': round(root_h),
            }
            continue

        # X position for this tier
        if direction == 'upstream':
            # Upstream: root on right, tiers extend left
            tier_x = PAD_X_START + (max_tier - t) * TIER_SPACING
        else:
            # Downstream: root on left, tiers extend right
            tier_x = PAD_X_START + t * TIER_SPACING

        # Compute heights for each node
        heights = []
        for n in tier_nodes:
            min_h = 5 if n.get('group') == 'other' else 3
            h = max(n.get('value', 0) * val_scale, min_h)
            heights.append(h)

        # Calculate total stacked height including group gaps
        pad = PAD_Y_OUTER if t >= 2 else PAD_Y
        total_stacked = sum(heights) + pad * max(0, len(heights) - 1)
        prev_group = None
        for n in tier_nodes:
            g = n.get('group', 'foreign')
            if prev_group == 'domestic' and g == 'foreign':
                total_stacked += GROUP_GAP
            if g == 'other' and prev_group != 'other' and prev_group is not None:
                total_stacked += OTHER_GAP
            prev_group = g

        # Start y: center the tier vertically
        start_y = (target_height - total_stacked) / 2
        current_y = start_y

        prev_group = None
        for n, h in zip(tier_nodes, heights):
            g = n.get('group', 'foreign')

            # Add group gaps
            if prev_group == 'domestic' and g == 'foreign':
                current_y += GROUP_GAP
            if g == 'other' and prev_group != 'other' and prev_group is not None:
                current_y += OTHER_GAP

            node_map[n['id']] = {
                **n,
                'x': round(tier_x),
                'y': round(current_y),
                'w': NODE_WIDTH,
                'h': round(max(h, 3)),
            }
            current_y += h + pad
            prev_group = g

    # Build root metadata
    root_node = nodes[0]
    root_info = {'id': root_node['id'], 'label': root_node['label']}

    # Build cumulative tier outputs (t1 has tiers 0-1, t2 has 0-2, t3 has 0-3)
    tier_outputs = {}
    for t in range(1, max_tier + 1):
        # Include all nodes up to this tier
        tier_nodes = [node_map[n['id']] for n in nodes
                      if n['tier'] <= t and n['id'] in node_map]

        # Include all links where both source and target are in included nodes
        included_ids = {n['id'] for n in tier_nodes}
        tier_links = [l for l in links
                      if l['source'] in included_ids and l['target'] in included_ids]

        tier_outputs[t] = {
            'direction': direction,
            'root': root_info,
            'tier': t,
            'nodes': tier_nodes,
            'links': tier_links,
            'meta': {
                'unit': 'MtCO2e',
                'topK': 10,
                'minShare': 0.005,
                'valScale': round(val_scale, 6),
            },
        }

    return tier_outputs
