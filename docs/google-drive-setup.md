# Google Drive Backup Setup Guide

This guide describes how to configure Google Drive cloud backups for Kaaj.

---

## 1. Architectural Decisions & Scope Justification

### Selected Scope: `https://www.googleapis.com/auth/drive.file`
- **Granular and narrow**: Grants access only to files and folders created or opened by Kaaj. Kaaj cannot view or touch any of your other Drive files.
- **User-visible in Google Drive**: Backups appear in a clear `My Drive/Kaaj` directory structure. You can view, download, or export entries and visual assets directly from the standard Google Drive web interface.
- **Safe from uninstallation deletion**: Unlike the hidden `drive.appdata` folder (which Google Drive permanently purges if the app is disconnected or uninstalled), files in `My Drive/Kaaj` remain your property forever.

### Refresh Token Expiry Rules
- **Google OAuth Testing Mode**: Refresh tokens issued for projects with Publishing Status set to **Testing** expire automatically after **7 days**.
- **Production Mode**: To prevent 7-day token expiration, set Publishing Status to **In production** in the Google Cloud Console OAuth consent screen. Verification by Google is not required for personal usage with your own Google account.

---

## 2. Google Cloud Console Configuration

Follow these steps to obtain OAuth credentials:

### Step 1: Create a Google Cloud Project
1. Open the [Google Cloud Console](https://console.cloud.google.com/).
2. Click the project dropdown at the top and select **New Project**.
3. Name the project `Kaaj` (or any preferred name) and click **Create**.

### Step 2: Enable the Google Drive API
1. Navigate to **APIs & Services** > **Library**.
2. Search for `Google Drive API`.
3. Click **Google Drive API** and select **Enable**.

### Step 3: Configure the OAuth Consent Screen
1. Navigate to **APIs & Services** > **OAuth consent screen**.
2. Select **External** user type and click **Create**.
3. Fill in the required fields:
   - **App name**: `Kaaj`
   - **User support email**: Your email address
   - **Developer contact information**: Your email address
4. Click **Save and Continue**.
5. Under **Scopes**, click **Add or Remove Scopes**.
6. Select or enter: `https://www.googleapis.com/auth/drive.file`.
7. Click **Save and Continue**.
8. Under **Test users**, add your own Google email address.
9. Click **Save and Continue**.
10. Navigate back to the OAuth consent screen tab and click **Publish App** to switch status to **In production**. This disables the 7-day refresh token expiration limit.

### Step 4: Create OAuth 2.0 Credentials
1. Navigate to **APIs & Services** > **Credentials**.
2. Click **Create Credentials** > **OAuth client ID**.
3. Select **Application type**: **Web application**.
4. Set **Name**: `Kaaj Local Server`.
5. Under **Authorized redirect URIs**, add:
   ```
   http://localhost:3001/auth/google/callback
   ```
6. Click **Create**.
7. Copy the **Client ID** and **Client Secret**.

---

## 3. Server Environment Configuration

Add the credentials to your `.env` file in the repository root (do not commit this file):

```env
GOOGLE_CLIENT_ID="<your-client-id>.apps.googleusercontent.com"
GOOGLE_CLIENT_SECRET="<your-client-secret>"
GOOGLE_REDIRECT_URI="http://localhost:3001/auth/google/callback"
```

The server stores the received refresh token in `data/google-oauth.json`. This path is strictly ignored by `.gitignore`. The server never logs refresh or access tokens.

---

## 4. Connecting Your Account

1. Start the Kaaj API server (`bun run dev`).
2. Visit the authentication endpoint in your browser:
   ```
   http://localhost:3001/auth/google/url
   ```
3. Open the `url` returned in your browser.
4. Consent to the requested permissions on Google's consent screen.
5. The browser will redirect to `http://localhost:3001/auth/google/callback` and show a confirmation screen.
6. Check connection status via:
   ```
   http://localhost:3001/auth/google/status
   ```
   It should return: `{"connected": true, "target": "google-drive"}`.

---

## 5. Verification Checklist

Execute these verification steps to ensure backups function properly:

- [ ] **Manual Backup Trigger**:
  Send a POST request to trigger a snapshot:
  ```bash
  curl -X POST http://localhost:3001/backup/trigger?wait=true \
       -H "Authorization: Bearer kaaj-local-dev-token"
  ```
  Verify the response returns `"success": true` with a valid `snapshotId`.

- [ ] **Verify Google Drive Directory Structure**:
  Open Google Drive and check `My Drive/Kaaj`:
  - `Kaaj/db-store.json`
  - `Kaaj/entries/<entryId>/manifest.json`
  - `Kaaj/entries/<entryId>/chunks/*.json`
  - `Kaaj/assets/*`
  - `Kaaj/snapshots/latest-manifest.json`

- [ ] **Verify Incremental Behavior**:
  Modify a single chunk in an entry. Trigger backup again. Check that only the modified chunk and updated snapshot manifest were uploaded.

- [ ] **Verify Snapshot Restore**:
  Run the restore script into a clean directory:
  ```bash
  bun scripts/restore-snapshot.ts --target drive --dest ./data-restored-test
  ```
  Verify all files and checksums match the original data directory.
