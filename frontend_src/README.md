# Frontend Source Modules

This directory is the editable source layer for the frontend.

## Workflow

1. Edit the semantic module files directly.
2. Run the regression check:
   - `python -u smoke_test.py`

## JS modules

- `modules/js/html_loader.js`
- `modules/js/core.js`
- `modules/js/chat.js`
- `modules/js/device.js`
- `modules/js/code.js`
- `modules/js/ui.js`

## CSS modules

- `modules/css/base.css`
- `modules/css/layout.css`
- `modules/css/device.css`
- `modules/css/chat.css`
- `modules/css/overlays.css`
- `modules/css/highlight.css`
- `modules/css/responsive.css`

## HTML module

- `modules/html/app_shell.html`

## Notes

- The browser entry `index.html` is now a thin bootstrap page.
- `modules/js/html_loader.js` loads `modules/html/app_shell.html`, then sequentially loads runtime scripts.

