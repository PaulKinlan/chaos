# Setting Up GCP OAuth for CHAOS

This guide walks through creating a Google Cloud project and configuring OAuth credentials for the CHAOS Chrome extension.

## Prerequisites

- A Google account
- Access to the [Google Cloud Console](https://console.cloud.google.com/)

## Step 1: Create a GCP Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Click the project dropdown at the top of the page
3. Click **New Project**
4. Enter a project name (e.g., "CHAOS Extension")
5. Select your organization (or leave as "No organization")
6. Click **Create**
7. Wait for the project to be created, then select it from the project dropdown

## Step 2: Enable Required APIs

1. Go to **APIs & Services > Library**
2. Search for and enable the following APIs as needed:
   - **Gmail API** (if using email channel or Gmail tools)
   - **Google Calendar API** (if using calendar tools)
   - **Google Drive API** (if using Drive tools)

## Step 3: Configure the OAuth Consent Screen

1. Go to **APIs & Services > OAuth consent screen**
2. Select **External** user type (unless you have a Google Workspace org and want internal-only)
3. Click **Create**
4. Fill in the required fields:
   - **App name:** CHAOS
   - **User support email:** your email address
   - **Developer contact email:** your email address
5. Click **Save and Continue**

### Scopes

1. Click **Add or Remove Scopes**
2. Add the scopes your agents will need. Common scopes:
   - `https://www.googleapis.com/auth/gmail.readonly` - Read Gmail messages
   - `https://www.googleapis.com/auth/gmail.compose` - Draft and send emails
   - `https://www.googleapis.com/auth/calendar.readonly` - Read calendar events
   - `https://www.googleapis.com/auth/calendar.events` - Create/edit calendar events
3. Click **Update** then **Save and Continue**

### Test Users

1. While the app is in "Testing" status, only test users can authenticate
2. Click **Add Users** and add your Google email address
3. Click **Save and Continue**

## Step 4: Create OAuth Client ID

1. Go to **APIs & Services > Credentials**
2. Click **Create Credentials > OAuth client ID**
3. Select **Chrome Extension** as the application type
4. Enter a name (e.g., "CHAOS Extension Client")
5. Enter your extension's **Item ID**:
   - If published: find it in the Chrome Web Store developer dashboard
   - If local/unpacked: load the extension in `chrome://extensions`, copy the ID shown there
6. Click **Create**
7. Copy the **Client ID** (you'll need this in the next step)

> **Note:** The Client ID will look like: `123456789-abcdefg.apps.googleusercontent.com`

## Step 5: Add Client ID to the Extension

1. Open `manifest.json` in the CHAOS extension source
2. Find the `oauth2` section and set your client ID:

```json
{
  "oauth2": {
    "client_id": "YOUR_CLIENT_ID_HERE.apps.googleusercontent.com",
    "scopes": [
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/calendar.readonly"
    ]
  }
}
```

3. Make sure the `key` field in `manifest.json` is set if you need a stable extension ID during development

## Step 6: Test the Auth Flow

1. Build the extension: `npm run build`
2. Load the unpacked extension from the `dist/` folder in `chrome://extensions`
3. Open the extension and trigger an action that requires Google auth
4. The OAuth consent screen should appear
5. Grant the requested permissions
6. Verify the extension can access the Google APIs

## Troubleshooting

### "Access blocked: This app's request is invalid"
- Verify the extension ID in the OAuth client matches the actual extension ID in `chrome://extensions`
- Make sure you're using the Chrome Extension application type, not Web Application

### "This app isn't verified"
- This is expected during development when the app is in "Testing" status
- Click **Continue** (only visible to test users added in Step 3)
- For production, you'll need to submit the app for verification

### "Error 400: redirect_uri_mismatch"
- Chrome extensions use `chrome.identity.launchWebAuthFlow`, which handles redirects automatically
- Make sure you selected "Chrome Extension" as the application type, not "Web Application"

### Token refresh issues
- Access tokens expire after ~1 hour
- The extension should handle refresh automatically using `chrome.identity.getAuthToken`
- If tokens stop working, try removing the extension from [Google Account permissions](https://myaccount.google.com/permissions) and re-authenticating

## Moving to Production

When ready to publish:

1. Submit the OAuth consent screen for **Google verification**
   - Required if using sensitive or restricted scopes
   - Google will review your app's privacy policy and usage
2. Move the app status from "Testing" to "In Production"
3. Publish the extension to the Chrome Web Store
4. Update the OAuth client with the published extension's Item ID
