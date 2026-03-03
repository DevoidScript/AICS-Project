# AICS — LGU Assistance Record Entry System

**LGU AICS** (Assistance to Individuals in Crisis Situations) is a web-based assistance record entry system for the **Social Welfare & Development Office** of the Municipality of Oton, Iloilo.

---

## Project Progress

### ✅ Completed

- **Assistance Record Entry Form** (`assistance-form.html`)
  - **Record identification**: ID Number, Date, Code
  - **Beneficiary information**: Name of Patient/Deceased, Address, Claimant
  - **Assistance details**: Type of Assistance (Burial, Medical, Financial, Educational, Food, Livelihood, Other), Remark
  - **Internal use**: Encoded By field
  - Required-field validation and Clear Form action

- **Styling** (`css/assistance-form.css`)
  - LGU-oriented theme (green accent, gold highlights, warm neutrals)
  - Responsive form layout with grid (2- and 3-column sections)
  - Typography: Playfair Display (headings), Source Sans 3 (body)
  - Modal, toast notifications, and print-specific styles

- **Form logic & integration** (`js/assistance-form.js`)
  - Form data collection and client-side validation
  - **Google Apps Script** integration: submissions sent to a Google Sheet via web app URL
  - **Record preview modal**: table view of submitted data with “Date Generated” footer
  - **PDF download**: landscape A4 table using jsPDF (CDN), filename `SWDO_<id>_<date>.pdf`
  - **Print slip**: printable slip with LGU Oton header (Republic of the Philippines, Province of Iloilo, Municipality of Oton), official seal image, and all record fields; print dialog shows only the slip via `@media print`

- **Assets**
  - **LGU Oton Official Seal (HD)** used in the print slip header (`images/LGU Oton Official Seal (HD).png`)

### 📁 Project Structure

```
AICS/
├── README.md
├── assistance-form.html    # Main entry form page
├── css/
│   └── assistance-form.css
├── js/
│   └── assistance-form.js
└── images/
    ├── README.txt
    └── LGU Oton Official Seal (HD).png
```

### 🔧 Technical Notes

- **Dependencies**: [jsPDF](https://github.com/parallax/jsPDF) loaded from CDN for PDF export.
- **Backend**: Data is sent to a Google Apps Script web app (URL in `js/assistance-form.js`). Ensure the linked Google Sheet and script are deployed and CORS/redirects are configured for your domain if needed.
- **Running**: Open `assistance-form.html` in a browser (or serve the folder with a local server so the seal image and assets load correctly when printing).

### 🚧 Possible Next Steps

- Replace placeholder header seal (emoji) in the page header with the actual LGU Oton seal image
- Add optional authentication or staff/session handling
- Add search or list view of existing records (if data is exposed via API or sheet)
- Environment-based or configurable Google Apps Script URL

---

## Security Setup

- `js/config.js` is excluded from Git via `.gitignore`.
- To configure a new environment:
  - Copy `js/config.example.js` to `js/config.js`.
  - Fill in your own **Google Apps Script web app URL** and a strong **secret token**.
- In the Google Apps Script project (`apps-script/Code.gs`):
  - Set `ALLOWED_TOKEN` to the **same secret token** used in `js/config.js`.
- The existing public Apps Script deployment URL in older commits should be considered compromised:
  - Deploy a **new** Apps Script web app deployment to get a fresh URL.
  - Update `APPS_SCRIPT_URL` in `js/config.js` to point to that new URL.

---

*Last updated: February 2025*
