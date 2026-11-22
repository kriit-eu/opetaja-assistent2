# Planned workload filters

The extension adds group and subject filters to
`#/lessonplans/vocational/byteacher`. This feature does not require Kriit.

Both filters accept partial names, ignore letter case, and apply together.
Suggestions use names from the loaded table. Subject headings and their related
group rows stay together. The overall totals are hidden while a filter is active;
the feature does not recalculate totals or change exported data.

Numeric body and footer cells are yellow unless they are empty or contain exactly
`0`. Table headers, dates, group names, and subject names are not highlighted.

Preferences use `OA_workloadFilters` in extension storage. When this key is absent,
the feature imports valid preferences from the former Tampermonkey script's
`henno-koormus-filters-v1` localStorage key. Clearing the filters saves empty
preferences, so old choices are not imported again.

## Switch from Tampermonkey

1. Load the updated extension build from `dist/`.
2. Disable the Tampermonkey script **Tahvel – koormuse filtrid ja numbrilahtrid**.
3. Reload the workload page.
4. Check that there is one filter panel, that the saved values return, and that
   both filters work together.

The extension does not change Tampermonkey settings. Do not keep both versions
enabled: they can hide different rows and display duplicate controls.
