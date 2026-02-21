/**
 * OneDrive module exports
 */

export {
  // Configuration
  isOneDriveConfigured,
  getOneDriveServerUrl,
  setOneDriveServerUrl,

  // Authentication
  isOneDriveAuthenticated,
  initializeOneDrive,
  isOneDriveConnected,
  disconnectOneDrive,
  logoutOneDrive,

  // OAuth Flow
  startOneDriveOAuthFlow,
  pollForOneDriveTokens,
  performOneDriveOAuthFlow,

  // Visible Folder Operations
  getOrCreateSlasshyFolder,
  uploadToOneDrive,
  uploadBufferToOneDrive,
  downloadFromOneDrive,
  downloadOneDriveToBuffer,
  deleteFromOneDrive,
  listOneDriveFiles,

  // Hidden App Folder Operations
  uploadToOneDriveAppFolder,
  uploadBufferToOneDriveAppFolder,
  downloadFromOneDriveAppFolder,
  downloadOneDriveAppFolderToBuffer,
  listOneDriveAppFolderFiles,
  findOneDriveAppFolderFile,
  deleteFromOneDriveAppFolder,
  updateOneDriveAppFolderFile,
  getOrCreateOneDriveVaultIndex,
  hasOneDriveAppFolderAccess,

  // User Info
  getOneDriveUserInfo,
  getOneDriveQuota,
} from './onedriveClient.js';
