"""
Ranking module: ranks country-sector pairs by total emissions.
"""


def rank_pairs(emissions_lookup, year, top_n=None):
    """
    Rank all country-sector pairs by total emissions for a given year.

    Parameters
    ----------
    emissions_lookup : EmissionsLookup
        Parsed emissions data.
    year : int
        Year to rank by.
    top_n : int, optional
        Return only top N pairs. If None, returns all.

    Returns
    -------
    list[dict] — ranked pairs with keys: iso3, isic, totalEmissions, rank
    """
    totals = emissions_lookup.get_totals_by_pair(year)
    totals = totals.sort_values('value', ascending=False).reset_index(drop=True)

    result = []
    for i, row in totals.iterrows():
        result.append({
            'iso3': row['iso3'],
            'isic': row['isic'],
            'totalEmissions': round(row['value'], 3),
            'rank': i + 1,
        })

    if top_n is not None:
        result = result[:top_n]

    return result
