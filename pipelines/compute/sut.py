"""
SUT heatmap builder: builds emission-weighted domestic inter-industry flow matrices.

For a given country, extracts the domestic block of the ICIO Z matrix,
weights it by emission factors (EF = S1/x), and adds aggregated IMPORTS
row and EXPORTS column.

Output: one JSON file per country with a 47×47 matrix (45 sectors + IMPORTS + EXPORTS).
"""

import numpy as np
import os
import yaml


def _load_lookups():
    config_dir = os.path.join(os.path.dirname(__file__), '..', 'config')
    with open(os.path.join(config_dir, 'countries.yaml')) as f:
        countries = yaml.safe_load(f)['countries']
    with open(os.path.join(config_dir, 'sectors.yaml')) as f:
        sectors = yaml.safe_load(f)['sectors']
    return countries, sectors


def build_sut_slice(icio, emissions_s1, iso3, year):
    """
    Build the SUT heatmap dataset for a single country.

    Parameters
    ----------
    icio : dict
        Parsed ICIO data (Z, x, labels, index, sectors, countries).
    emissions_s1 : np.ndarray
        S1 emissions vector aligned to ICIO labels (length 3465).
    iso3 : str
        Country ISO3 code.
    year : int

    Returns
    -------
    dict — JSON-serializable SUT heatmap slice, or None if country not found.
    """
    countries_map, sectors_map = _load_lookups()
    Z = icio['Z']
    x = icio['x']
    labels = icio['labels']
    sector_codes = icio['sectors']
    N = len(x)

    # Emission factors: EF = S1 / x (handle division by zero)
    ef = np.zeros(N)
    nonzero = x > 0
    ef[nonzero] = emissions_s1[nonzero] / x[nonzero]

    # Find indices for this country's sectors
    country_indices = []
    for isic in sector_codes:
        idx = icio['index'].get((iso3, isic))
        if idx is not None:
            country_indices.append(idx)

    if not country_indices:
        return None

    n_sectors = len(sector_codes)
    ci = np.array(country_indices)

    # All indices NOT belonging to this country
    all_indices = np.arange(N)
    foreign_mask = np.ones(N, dtype=bool)
    foreign_mask[ci] = False
    foreign_indices = all_indices[foreign_mask]

    # ── Domestic block: emission-weighted ──
    # Z_domestic[i, j] = EF[ci[i]] * Z[ci[i], ci[j]]
    Z_domestic = Z[np.ix_(ci, ci)]  # 45×45
    ef_domestic = ef[ci]
    # Emission-weighted: diag(EF_domestic) @ Z_domestic
    ew_domestic = np.diag(ef_domestic) @ Z_domestic  # 45×45

    # ── IMPORTS row: emission-weighted foreign inputs into each domestic sector ──
    # For each domestic column j: sum over all foreign i of EF[i] * Z[i, ci[j]]
    Z_foreign_to_domestic = Z[np.ix_(foreign_indices, ci)]  # (N-45)×45
    ef_foreign = ef[foreign_indices]
    imports_row = ef_foreign @ Z_foreign_to_domestic  # length 45

    # ── EXPORTS column: emission-weighted domestic outputs to foreign sectors ──
    # For each domestic row i: sum over all foreign j of EF[ci[i]] * Z[ci[i], fj]
    Z_domestic_to_foreign = Z[np.ix_(ci, foreign_indices)]  # 45×(N-45)
    exports_col = ef_domestic * Z_domestic_to_foreign.sum(axis=1)  # length 45

    # IMPORTS-to-EXPORTS corner cell (foreign→foreign doesn't apply, set to 0)
    imports_exports_corner = 0.0

    # ── Assemble the full matrix (n_sectors+1) × (n_sectors+1) ──
    full_rows = n_sectors + 1  # 45 sectors + IMPORTS
    full_cols = n_sectors + 1  # 45 sectors + EXPORTS
    matrix = np.zeros((full_rows, full_cols))

    # Domestic block
    matrix[:n_sectors, :n_sectors] = ew_domestic

    # IMPORTS row (last row, first 45 cols)
    matrix[n_sectors, :n_sectors] = imports_row

    # EXPORTS column (first 45 rows, last col)
    matrix[:n_sectors, n_sectors] = exports_col

    # Corner
    matrix[n_sectors, n_sectors] = imports_exports_corner

    # ── Build JSON arrays ──
    row_keys = list(sector_codes) + ['IMPORTS']
    col_keys = list(sector_codes) + ['EXPORTS']

    row_labels = {isic: sectors_map.get(isic, isic) for isic in sector_codes}
    row_labels['IMPORTS'] = 'Imports (all foreign)'

    col_labels = {isic: sectors_map.get(isic, isic) for isic in sector_codes}
    col_labels['EXPORTS'] = 'Exports (all foreign)'

    # Convert matrix to nested list, rounding to 3 decimal places
    values = [[round(float(matrix[i, j]), 3) for j in range(full_cols)]
              for i in range(full_rows)]

    return {
        'country': iso3,
        'countryName': countries_map.get(iso3, iso3),
        'year': int(year),
        'unit': 'MtCO2e',
        'rows': row_keys,
        'cols': col_keys,
        'values': values,
        'rowLabels': row_labels,
        'colLabels': col_labels,
    }
