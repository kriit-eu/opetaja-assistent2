# Recovering incorrect Kriit homework links (#168)

Kriit assignment IDs and Tahvel journal-entry IDs are separate identifiers. Homework links must use the internal Kriit assignment ID returned by the differences API, not `assignmentExternalId`.

## Automatic repair

After installing the fix, the next grade or assignment-metadata synchronization for an affected assignment repairs links on the configured Kriit instance that use that assignment's Tahvel entry ID. Surrounding instructions, HTML, query parameters and unrelated links are preserved. Correct links are not duplicated. If no internal Kriit ID is available, homework is left unchanged.

Assignments without pending differences are not rewritten automatically. To repair one, either synchronize a legitimate metadata change from Kriit or edit the homework in Tahvel manually.

## Manual repair

1. Open the intended assignment in Kriit and copy its URL from the address bar.
2. Open the corresponding journal entry in Tahvel.
3. Replace only the incorrect assignment URL in the homework field with the copied URL, retaining any required group parameter and all other instructions.
4. Save and verify that the link opens the intended assignment.

Do not infer a Kriit assignment ID from the Tahvel journal-entry ID. This fix cannot restore instructions already deleted by an earlier synchronization; recover those from an available original or backup.
