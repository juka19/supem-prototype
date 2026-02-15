"""
Emissions Parser: reads OECD DF_SCOPE CSV into a pandas DataFrame.

CSV structure:
  TIME_PERIOD, MEASURE, EMISSIONS_ORIGIN_AREA, ACTIVITY, EMISSIONS_SCOPE,
  UNIT_MEASURE, UNIT_MULT, OBS_VALUE

All values are in Mt CO2e (UNIT_MULT=6 means 10^6 tonnes).
Scopes: S1 (direct), S2 (electricity/heat), S3U (upstream), S3D (downstream), _T (total).
"""

import pandas as pd


def parse_emissions(csv_path, years=None):
    """
    Parse DF_SCOPE.csv into a clean DataFrame.

    Parameters
    ----------
    csv_path : str
        Path to DF_SCOPE.csv.
    years : list[int], optional
        Filter to specific years. If None, loads all years.

    Returns
    -------
    pd.DataFrame with columns: year, iso3, isic, scope, value
        Values are in Mt CO2e.
    """
    df = pd.read_csv(csv_path)

    # Rename to clean column names
    df = df.rename(columns={
        'TIME_PERIOD': 'year',
        'EMISSIONS_ORIGIN_AREA': 'iso3',
        'ACTIVITY': 'isic',
        'EMISSIONS_SCOPE': 'scope',
        'OBS_VALUE': 'value',
    })

    # Keep only needed columns
    df = df[['year', 'iso3', 'isic', 'scope', 'value']].copy()

    # Map WXD -> ROW for ICIO alignment
    df['iso3'] = df['iso3'].replace('WXD', 'ROW')

    # Filter years if specified
    if years is not None:
        df = df[df['year'].isin(years)]

    # Sort for consistent ordering
    df = df.sort_values(['year', 'iso3', 'isic', 'scope']).reset_index(drop=True)

    return df


class EmissionsLookup:
    """Fast lookup wrapper around the parsed emissions DataFrame."""

    def __init__(self, df):
        self._df = df
        # Build multi-index for fast lookups
        self._indexed = df.set_index(['year', 'iso3', 'isic', 'scope'])['value']

    def get(self, year, iso3, isic, scope):
        """Get a single emissions value. Returns 0.0 if not found."""
        try:
            return float(self._indexed.loc[(year, iso3, isic, scope)])
        except KeyError:
            return 0.0

    def get_total(self, year, iso3, isic):
        """Get total emissions (_T scope)."""
        return self.get(year, iso3, isic, '_T')

    def get_scopes(self, year, iso3, isic):
        """Get all 4 scopes as a dict {scope_id: value}."""
        return {
            'S1': self.get(year, iso3, isic, 'S1'),
            'S2': self.get(year, iso3, isic, 'S2'),
            'S3U': self.get(year, iso3, isic, 'S3U'),
            'S3D': self.get(year, iso3, isic, 'S3D'),
        }

    def get_totals_by_pair(self, year):
        """
        Get total emissions for all (iso3, isic) pairs in a given year.

        Returns
        -------
        pd.DataFrame with columns: iso3, isic, value
        """
        mask = (self._df['year'] == year) & (self._df['scope'] == '_T')
        return self._df.loc[mask, ['iso3', 'isic', 'value']].copy()

    @property
    def years(self):
        """Available years in the dataset."""
        return sorted(self._df['year'].unique())
