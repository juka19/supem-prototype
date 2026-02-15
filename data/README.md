# Data Directory

This directory holds local data files for the pipeline. Contents are **gitignored** except this README and `.gitkeep`.

## Expected structure

```
data/
  raw/
    2016-2020_SML/          # OECD ICIO CSV files (one per year)
      2016_SML.csv
      2017_SML.csv
      2018_SML.csv
      2019_SML.csv
      2020_SML.csv
    DF_SCOPE_csv/           # GHG emissions by scope
      DF_SCOPE.csv
  intermediate/             # Cached parsed matrices (.npz) — auto-generated
  out/                      # Generated JSON slices — auto-generated
```

## How to obtain source data

1. **ICIO tables**: Download from [OECD ICIO](https://www.oecd.org/sti/ind/inter-country-input-output-tables.htm). Place CSV files in `data/raw/2016-2020_SML/`.
2. **DF_SCOPE emissions**: Download from OECD. Place `DF_SCOPE.csv` in `data/raw/DF_SCOPE_csv/`.
