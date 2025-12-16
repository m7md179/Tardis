package cmd

import (
	"fmt"
	"os"

	"github.com/spf13/cobra"
	"tardis/internal/sheets"
)

var configCmd = &cobra.Command{
	Use:   "config",
	Short: "Configure Google Sheets sync",
	Long:  `Configure the Google Sheets spreadsheet ID for syncing sessions.`,
	Run: func(cmd *cobra.Command, args []string) {
		storagePath := getStoragePath()
		
		if spreadsheetID == "" {
			fmt.Fprintf(os.Stderr, "Error: --spreadsheet-id is required\n")
			os.Exit(1)
		}
		
		if err := sheets.SaveConfig(storagePath, spreadsheetID); err != nil {
			fmt.Fprintf(os.Stderr, "Error: Failed to save config: %v\n", err)
			os.Exit(1)
		}
		
		fmt.Printf("✓ Configuration saved. Spreadsheet ID: %s\n", spreadsheetID)
	},
}

var spreadsheetID string

func init() {
	configCmd.Flags().StringVar(&spreadsheetID, "spreadsheet-id", "", "Google Sheets spreadsheet ID")
	configCmd.MarkFlagRequired("spreadsheet-id")
}

