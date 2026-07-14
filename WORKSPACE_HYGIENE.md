# Workspace Hygiene Guidelines

To maintain a production-ready environment, the following rules apply to all development activity:

1. **No Temporary Scripts**: Never leave `.py`, `.sh`, or `.js` utility scripts (e.g., `fix-*.py`, `add-imports.py`) in the root or source directories after use.
2. **No Patch Files**: `.patch` files used for temporary diffing or local hotfixes must be deleted immediately after application.
3. **No Legacy Modules**: Do not leave standalone `.cjs`, `.mjs`, or `.js` files (e.g., `parse_glb.js`) in the workspace if they are not part of the authoritative build pipeline.
4. **Clean Root**: The root directory should only contain configuration files (`package.json`, `tsconfig.json`, etc.) and project documentation.

Strict adherence to these rules prevents technical debt and reduces cognitive load during implementation.
