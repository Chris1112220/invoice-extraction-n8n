"""Generates the 5 fictitious test invoices used to validate the workflow.
Requires: pip install reportlab
"""
from reportlab.lib.pagesizes import letter
from reportlab.lib import colors
from reportlab.lib.units import inch
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
import os

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "invoices")
os.makedirs(OUT, exist_ok=True)
ss = getSampleStyleSheet()
H = ParagraphStyle("H", parent=ss["Title"], alignment=0, fontSize=20, spaceAfter=4)
N = ss["Normal"]
SMALL = ParagraphStyle("S", parent=N, fontSize=8, textColor=colors.grey)

BILL_TO = "Smith &amp; Associates CPAs<br/>1500 Market St, Suite 400<br/>Philadelphia, PA 19102"

invoices = [
    dict(file="01_clean_liberty_bell.pdf", vendor="Liberty Bell Office Supply",
         addr="220 N 3rd St, Philadelphia, PA 19106", label="Invoice #", num="INV-10482",
         date="09/15/2026", due="10/15/2026",
         items=[("Copy paper, 10 cases", 10, 42.00), ("Toner cartridges", 4, 155.00), ("Desk organizers", 4, 49.00)],
         tax_label="Sales Tax (6%)", tax=74.16, total=None),
    dict(file="02_clean_schuylkill_it.pdf", vendor="Schuylkill IT Services LLC",
         addr="3001 Walnut St, Philadelphia, PA 19104", label="Invoice No.", num="SIT-2026-0917",
         date="September 17, 2026", due="October 17, 2026",
         items=[("Managed IT support - September", 1, 2500.00), ("Firewall configuration", 1, 1000.00)],
         tax_label="Tax", tax=0.00, total=None),
    dict(file="03_math_error_fishtown_print.pdf", vendor="Fishtown Print & Copy",
         addr="1200 Frankford Ave, Philadelphia, PA 19125", label="Invoice #", num="7731",
         date="09/22/2026", due="10/22/2026",
         items=[("Client newsletter printing (500)", 1, 600.00), ("Tax season mailers (1,000)", 1, 260.00)],
         tax_label="Sales Tax (6%)", tax=51.60, total=921.60),  # should be 911.60
    dict(file="04_missing_invoice_number_rittenhouse.pdf", vendor="Rittenhouse Cleaning Co.",
         addr="1800 Spruce St, Philadelphia, PA 19103", label=None, num=None,
         date="09/25/2026", due="10/10/2026",
         items=[("Office cleaning - September (weekly)", 4, 112.50)],
         tax_label="Sales Tax (6%)", tax=27.00, total=None),
    dict(file="05_no_due_date_delaware_valley.pdf", vendor="Delaware Valley Courier",
         addr="4500 S Broad St, Philadelphia, PA 19112", label="Bill No.", num="55-0193",
         date="Sep 28, 2026", due="Due upon receipt",
         items=[("Same-day document delivery", 10, 31.25)],
         tax_label="Sales Tax (8%)", tax=25.00, total=None),
]

for inv in invoices:
    doc = SimpleDocTemplate(os.path.join(OUT, inv["file"]), pagesize=letter,
                            leftMargin=0.8*inch, rightMargin=0.8*inch, topMargin=0.7*inch)
    el = [Paragraph(inv["vendor"], H), Paragraph(inv["addr"], N), Spacer(1, 18),
          Paragraph("<b>INVOICE</b>", ParagraphStyle("I", parent=N, fontSize=14)), Spacer(1, 8)]
    meta = []
    if inv["label"]:
        meta.append([inv["label"], inv["num"]])
    meta += [["Invoice Date", inv["date"]], ["Due Date", inv["due"]]]
    mt = Table(meta, colWidths=[1.4*inch, 2.4*inch])
    mt.setStyle(TableStyle([("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"), ("FONTSIZE", (0, 0), (-1, -1), 10)]))
    bt = Table([[Paragraph("<b>Bill To</b><br/>" + BILL_TO, N), mt]], colWidths=[3.1*inch, 3.8*inch])
    bt.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP")]))
    el += [bt, Spacer(1, 20)]
    rows = [["Description", "Qty", "Unit Price", "Amount"]]
    subtotal = 0
    for d, q, p in inv["items"]:
        amt = round(q * p, 2)
        subtotal += amt
        rows.append([d, str(q), f"${p:,.2f}", f"${amt:,.2f}"])
    subtotal = round(subtotal, 2)
    total = inv["total"] if inv["total"] is not None else round(subtotal + inv["tax"], 2)
    rows += [["", "", "Subtotal", f"${subtotal:,.2f}"],
             ["", "", inv["tax_label"], f"${inv['tax']:,.2f}"],
             ["", "", "TOTAL DUE", f"${total:,.2f}"]]
    t = Table(rows, colWidths=[3.6*inch, 0.6*inch, 1.4*inch, 1.3*inch])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#2F4F6F")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("ALIGN", (1, 0), (-1, -1), "RIGHT"),
        ("LINEBELOW", (0, 0), (-1, len(inv["items"])), 0.5, colors.lightgrey),
        ("FONTNAME", (2, -1), (-1, -1), "Helvetica-Bold"),
        ("LINEABOVE", (2, -1), (-1, -1), 1, colors.black),
    ]))
    el += [t, Spacer(1, 30), Paragraph("Thank you for your business. Please remit payment to the address above.", N),
           Spacer(1, 40), Paragraph("SAMPLE DOCUMENT - fictitious vendor, created for automation testing only.", SMALL)]
    doc.build(el)
    print(inv["file"], "subtotal", subtotal, "tax", inv["tax"], "total", total)
