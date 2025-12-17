package cmd

import (
	"fmt"
	"os"

	"tardis/internal/storage"

	"github.com/spf13/cobra"
)

var listCmd = &cobra.Command{
	Use:   "list",
	Short: "List all active work sessions",
	Long:  `List all active and paused work sessions with their status, duration, and start time.`,
	Run: func(cmd *cobra.Command, args []string) {
		store, err := storage.New(getStoragePath())
		if err != nil {
			fmt.Fprintf(os.Stderr, "Error: Failed to initialize storage: %v\n", err)
			os.Exit(1)
		}
		
		allSessions, err := store.GetAllActiveSessions()
		if err != nil {
			fmt.Fprintf(os.Stderr, "Error: Failed to get active sessions: %v\n", err)
			os.Exit(1)
		}
		
		if len(allSessions) == 0 {
			fmt.Println("No active sessions.")
			return
		}
		
		fmt.Printf("Active Sessions (%d):\n\n", len(allSessions))
		
		for i, sess := range allSessions {
			status := "ACTIVE"
			if sess.IsPaused {
				status = "PAUSED"
			}
			
			fmt.Printf("%d. %s\n", i+1, sess.Task)
			fmt.Printf("   Status: %s\n", status)
			fmt.Printf("   Started: %s\n", formatTime(sess.StartTime))
			fmt.Printf("   Duration: %s\n", sess.GetFormattedDuration())
			
			if i < len(allSessions)-1 {
				fmt.Println()
			}
		}
	},
}


