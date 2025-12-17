package cmd

import (
	"fmt"
	"os"
	"strings"

	"tardis/internal/storage"

	"github.com/spf13/cobra"
)

var deleteCmd = &cobra.Command{
	Use:   "delete [task]",
	Short: "Delete a session from storage",
	Long:  `Delete a session (active or archived) by task name from storage.`,
	Args:  cobra.MinimumNArgs(1),
	Run: func(cmd *cobra.Command, args []string) {
		taskName := strings.Join(args, " ")
		
		store, err := storage.New(getStoragePath())
		if err != nil {
			fmt.Fprintf(os.Stderr, "Error: Failed to initialize storage: %v\n", err)
			os.Exit(1)
		}
		
		if err := store.DeleteSessionByTask(taskName); err != nil {
			fmt.Fprintf(os.Stderr, "Error: %v\n", err)
			os.Exit(1)
		}
		
		fmt.Printf("Session '%s' deleted successfully.\n", taskName)
	},
}
