package cmd

import (
	"bufio"
	"fmt"
	"os"
	"strings"

	"tardis/internal/storage"

	"github.com/spf13/cobra"
)

var wipeCmd = &cobra.Command{
	Use:   "wipe",
	Short: "Delete all sessions from storage",
	Long:  `Delete all active and archived sessions from storage. This action cannot be undone.`,
	Run: func(cmd *cobra.Command, args []string) {
		fmt.Print("Warning: This will delete ALL sessions (active and archived). Are you sure? (yes/no): ")
		reader := bufio.NewReader(os.Stdin)
		response, err := reader.ReadString('\n')
		if err != nil {
			fmt.Fprintf(os.Stderr, "Error: Failed to read input: %v\n", err)
			os.Exit(1)
		}
		
		response = strings.TrimSpace(strings.ToLower(response))
		if response != "yes" && response != "y" {
			fmt.Println("Cancelled.")
			return
		}
		
		store, err := storage.New(getStoragePath())
		if err != nil {
			fmt.Fprintf(os.Stderr, "Error: Failed to initialize storage: %v\n", err)
			os.Exit(1)
		}
		
		if err := store.WipeAllSessions(); err != nil {
			fmt.Fprintf(os.Stderr, "Error: Failed to wipe sessions: %v\n", err)
			os.Exit(1)
		}
		
		fmt.Println("All sessions deleted successfully.")
	},
}
