package cmd

import (
	"tardis/internal/session"
	"tardis/internal/sheets"
	"tardis/internal/storage"
)

func syncToSheets(store *storage.Storage, sess *session.Session) error {
	storagePath := store.GetStoragePath()
	
	// Check if Google Sheets is configured
	if !sheets.IsConfigured(storagePath) {
		return nil // Not configured, skip silently
	}
	
	return sheets.SyncSession(storagePath, sess)
}

