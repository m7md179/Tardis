package cmd

import (
	"fmt"
	"os"

	"github.com/spf13/cobra"
	"tardis/internal/sheets"
)

var authCmd = &cobra.Command{
	Use:   "auth [code]",
	Short: "Authenticate with Google Sheets",
	Long: `Authenticate with Google Sheets for syncing sessions.
If no code is provided, this will open a browser window for authorization.
After authorizing, you'll get a code. Run 'tardis auth <code>' to complete authentication.`,
	Args: cobra.MaximumNArgs(1),
	Run: func(cmd *cobra.Command, args []string) {
		storagePath := getStoragePath()
		
		// Check if credentials file exists
		if !sheets.HasCredentials(storagePath) {
			fmt.Fprintf(os.Stderr, "Google Sheets credentials not found.\n\n")
			fmt.Fprintf(os.Stderr, "Note: Google Sheets sync is OPTIONAL. TARDIS works fine without it!\n")
			fmt.Fprintf(os.Stderr, "All your sessions are stored locally in %s\n\n", storagePath)
			fmt.Fprintf(os.Stderr, "To set up Google Sheets sync (optional):\n")
			fmt.Fprintf(os.Stderr, "1. Go to https://console.cloud.google.com/\n")
			fmt.Fprintf(os.Stderr, "2. Create a new project or select an existing one\n")
			fmt.Fprintf(os.Stderr, "3. Enable the Google Sheets API\n")
			fmt.Fprintf(os.Stderr, "4. Create credentials (OAuth 2.0 Client ID) for a Desktop application\n")
			fmt.Fprintf(os.Stderr, "5. Download the credentials JSON file\n")
			fmt.Fprintf(os.Stderr, "6. Save it as: %s/credentials.json\n\n", storagePath)
			fmt.Fprintf(os.Stderr, "See GOOGLE_SHEETS_SETUP.md for detailed instructions.\n")
			fmt.Fprintf(os.Stderr, "Then run 'tardis auth' again.\n")
			os.Exit(1)
		}
		
		if len(args) == 0 {
			// Start OAuth flow
			url, err := sheets.GetAuthURL(storagePath)
			if err != nil {
				fmt.Fprintf(os.Stderr, "Error: Failed to get auth URL: %v\n", err)
				os.Exit(1)
			}
			
			fmt.Println("Please visit this URL to authorize the application:")
			fmt.Println(url)
			fmt.Println("\nAfter authorization, you'll receive a code.")
			fmt.Println("Run 'tardis auth <code>' to complete authentication.")
		} else {
			// Complete OAuth flow with code
			code := args[0]
			if err := sheets.CompleteAuth(storagePath, code); err != nil {
				fmt.Fprintf(os.Stderr, "Error: Failed to complete authentication: %v\n", err)
				os.Exit(1)
			}
			
			fmt.Println("✓ Authentication successful!")
		}
	},
}

