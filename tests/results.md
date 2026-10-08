| Group | Case | Expected | Result | Pass |
|---|---|---|---|---|
| structure | Workflow JSON parses | valid JSON | 33 nodes | ✅ |
| structure | Node ids and names are unique | no duplicates | as expected | ✅ |
| structure | Node types/typeVersions are ones this workflow already used (or standard Set/NoOp/Sticky) | all known | as expected | ✅ |
| structure | Every connection points to an existing node | no dangling links | 36 connections | ✅ |
| structure | No orphan nodes (all non-trigger nodes have an input and are reachable from a trigger; sticky note excluded) | none | as expected | ✅ |
| structure | Every $('Node') reference names an existing upstream node | all resolve | 30 references checked | ✅ |
| structure | All Code nodes compile | no syntax errors | 6 Code nodes | ✅ |
| structure | Prompt + schema defined once (Config); all 3 Gemini nodes share one body expression | 1 copy, 3 references | as expected | ✅ |
| structure | All 3 Gemini nodes have a connected error output; the last one routes to the failure alert | yes | as expected | ✅ |
| structure | Placeholders present | 4 placeholders | as expected | ✅ |
| sample PDFs | 01_clean_liberty_bell.pdf | OK; logged; renamed 2026-09_LibertyBellOfficeSupply_INV10482.pdf; moved; no email | OK; 1 logged; 1 renamed; 1 moved; no email | ✅ |
| sample PDFs | 02_clean_schuylkill_it.pdf | OK; logged; renamed 2026-09_SchuylkillITServicesLLC_SIT20260917.pdf; moved; no email | OK; 1 logged; 1 renamed; 1 moved; no email | ✅ |
| sample PDFs | 03_math_error_fishtown_print.pdf | Needs Review ("Total mismatch: subtotal + tax = 911.60, invoice says 921.60"); logged; renamed 2026-09_FishtownPrintCopy_7731.pdf; moved; Needs Review email | Needs Review: "Total mismatch: subtotal + tax = 911.60, invoice says 921.60"; 1 logged; 1 renamed; 1 moved; [Needs Review] Invoice 7731 - Fishtown Print & Copy | ✅ |
| sample PDFs | 04_missing_invoice_number_rittenhouse.pdf | Needs Review ("Missing Invoice #"); logged; renamed 2026-09_RittenhouseCleaningCo_NOINV.pdf; moved; Needs Review email | Needs Review: "Missing Invoice #"; 1 logged; 1 renamed; 1 moved; [Needs Review] Invoice (no #) - Rittenhouse Cleaning Co. | ✅ |
| sample PDFs | 05_no_due_date_delaware_valley.pdf | Needs Review ("No due date (Due upon receipt)"); logged; renamed 2026-09_DelawareValleyCourier_550193.pdf; moved; Needs Review email | Needs Review: "No due date (Due upon receipt)"; 1 logged; 1 renamed; 1 moved; [Needs Review] Invoice 55-0193 - Delaware Valley Courier | ✅ |
| batch | Reprocess Inbox backfill: all 5 samples at once, empty sheet | 5 logged/renamed/moved, 3 Needs Review emails, 0 OK emails | 5 logged; 5 renamed; 5 moved; [Needs Review] Invoice 7731 - Fishtown Print & Copy \| [Needs Review] Invoice (no #) - Rittenhouse Cleaning Co. \| [Needs Review] Invoice 55-0193 - Delaware Valley Courier | ✅ |
| edge | Empty candidates from all 3 models | tries 3 models, failure-alert email with file name/ID + reason, nothing logged/renamed | [Extraction Failed] 01_clean_liberty_bell.pdf; "Error (last model): Gemini answered but returned no usable content (empty response)" | ✅ |
| edge | Empty candidates from primary, fallback 3.1 answers | falls back, OK, Model Used = Gemini 3.1 Flash Lite | OK; 1 logged; 1 renamed; 1 moved; no email | ✅ |
| edge | Prompt blocked (promptFeedback.blockReason=SAFETY) on all 3 | failure alert naming SAFETY, nothing logged | [Extraction Failed] 03_math_error_fishtown_print.pdf | ✅ |
| edge | HTTP error (429) on all 3 models | failure alert with the last error message, nothing logged | [Extraction Failed] 02_clean_schuylkill_it.pdf | ✅ |
| edge | HTTP 429 on primary, then 3.1 returns empty, then 3.7 answers | OK via Gemini 3.7 Flash | OK; 1 logged; 1 renamed; 1 moved; no email | ✅ |
| edge | Malformed JSON from Gemini (truncated object) | no crash; Needs Review "AI response was not valid JSON ... Enter this invoice manually"; original file name kept; email | Needs Review: "AI response was not valid JSON (Expected ',' or '}' after property value in JSON at position 83 (line 1 column 84)). Enter this invoice manually"; 1 logged; 1 renamed; 1 moved; [Needs Review] Invoice (no #) - 01_clean_liberty_bell.pdf | ✅ |
| edge | Gemini wraps JSON in ```json fences | parsed normally, OK | OK; 1 logged; 1 renamed; 1 moved; no email | ✅ |
| dedupe | Same Drive file seen again (file ID already in Invoice Log) | skipped before download: 0 Gemini calls, no log/rename/move/email | routed to "Skip: File Already Logged" | ✅ |
| dedupe | Re-uploaded copy (new file ID) of an already-logged invoice; vendor/invoice # differ only in format ("Delaware Valley Courier LLC", "55 0193") | skipped after extraction: no log/rename/move/email | "Already in Invoice Log: same vendor + invoice # (sheet row 2)" | ✅ |
| dedupe | Two copies of the same invoice in one backfill (different file IDs) | first logged, second skipped | OK \| OK; 1 logged; 1 renamed; 1 moved; no email | ✅ |
| dedupe | Two copies in one run, answered by different models (Parse/Check Duplicate run twice) | still only one logged | OK \| OK; 1 logged; 1 renamed; 1 moved; no email | ✅ |
| dedupe | Invoice with no invoice # is not deduped on vendor alone | Rittenhouse logged even though a Rittenhouse row exists | Needs Review: "Missing Invoice #"; 1 logged; 1 renamed; 1 moved; [Needs Review] Invoice (no #) - Rittenhouse Cleaning Co. | ✅ |
| edge | Non-PDF dropped in the Inbox (image/jpeg) | logged as "Skipped - Not a PDF", no download/Gemini/rename/email | Skipped - Not a PDF: "Not processed: file type is image/jpeg, only PDFs are read" | ✅ |
| edge | Mixed poll: 1 PDF + 1 non-PDF | PDF processed, non-PDF logged | OK; 1 logged; 1 renamed; 1 moved; no email | ✅ |
| validation | Date returned as 09/15/2026 instead of YYYY-MM-DD | Needs Review with date note; file month = UNDATED | "Invoice Date is not a valid YYYY-MM-DD date ("09/15/2026"); Due Date is not a valid YYYY-MM-DD date ("2026-02-30")" | ✅ |
| validation | Total present but tax missing | Needs Review "Cannot verify total: missing Tax" | Needs Review: "Cannot verify total: missing Tax"; 1 logged; 1 renamed; 1 moved; [Needs Review] Invoice INV-10482 - Liberty Bell Office Supply | ✅ |
| validation | Amounts returned as strings ("1,236.00") | coerced to numbers, OK | OK; 1 logged; 1 renamed; 1 moved; no email | ✅ |
| timezone | Processed date uses America/New_York at 10:30 PM ET (02:30 UTC next day) | Date Processed 2026-10-08, Processed At "2026-10-08 22:30:00 EDT" (v1.2 would have written 2026-10-09) | 2026-10-08 / 2026-10-08 22:30:00 EDT | ✅ |

**34 / 34 passed** (offline simulator, fixed clock 2026-10-09T02:30:00.000Z).
