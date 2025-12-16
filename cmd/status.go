package cmd

import (
	"fmt"
	"os"

	"github.com/spf13/cobra"
	"tardis/internal/storage"
)

var statusCmd = &cobra.Command{
	Use:   "status",
	Short: "Show the status of the current work session",
	Long:  `Show the current status, task, start time, and duration of the active session.`,
	Run: func(cmd *cobra.Command, args []string) {
		store, err := storage.New(getStoragePath())
		if err != nil {
			fmt.Fprintf(os.Stderr, "Error: Failed to initialize storage: %v\n", err)
			os.Exit(1)
		}
		
		current, err := store.GetCurrentSession()
		if err != nil {
			fmt.Fprintf(os.Stderr, "Error: Failed to get current session: %v\n", err)
			os.Exit(1)
		}
		
		if current == nil || current.IsEnded() {
			fmt.Println("Status: NO ACTIVE SESSION")
			return
		}
		
		status := "ACTIVE"
		if current.IsPaused {
			status = "PAUSED"
		}
		
		fmt.Printf("Status: %s\n", status)
		fmt.Printf("Task: %s\n", current.Task)
		fmt.Printf("Started: %s\n", formatTime(current.StartTime))
		fmt.Printf("Duration: %s\n", current.GetFormattedDuration())
	},
}

