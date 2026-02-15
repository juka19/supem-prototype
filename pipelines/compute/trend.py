"""
Trend slice builder: generates time-series data for the bar chart visualization.
"""

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


def build_trend_slice(emissions_lookup, iso3, isic, years=None):
    """
    Build a trend (time series) JSON slice for a country-sector pair.

    Parameters
    ----------
    emissions_lookup : EmissionsLookup
        Parsed emissions data.
    iso3 : str
        Country code (e.g., 'DEU').
    isic : str
        Sector code (e.g., 'C29').
    years : list[int], optional
        Years to include. Defaults to all available years.

    Returns
    -------
    dict — JSON-serializable trend slice.
    """
    countries, sectors = _load_lookups()

    if years is None:
        years = emissions_lookup.years

    series = []
    for year in sorted(years):
        val = emissions_lookup.get_total(year, iso3, isic)
        series.append({'year': int(year), 'value': round(val, 3)})

    return {
        'country': iso3,
        'countryName': countries.get(iso3, iso3),
        'sector': isic,
        'sectorName': sectors.get(isic, isic),
        'unit': 'MtCO2e',
        'series': series,
    }
