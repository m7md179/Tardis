package cmd

import (
	"fmt"
	"os"
	"strings"

	"tardis/internal/session"
	"tardis/internal/storage"

	"github.com/spf13/cobra"
)

var statusCmd = &cobra.Command{
	Use:   "status [task]",
	Short: "Show the status of a work session",
	Long:  `Show the status, task, start time, and duration of a work session. If no task name is provided, shows the most recent session.`,
	Run: func(cmd *cobra.Command, args []string) {
		store, err := storage.New(getStoragePath())
		if err != nil {
			fmt.Fprintf(os.Stderr, "Error: Failed to initialize storage: %v\n", err)
			os.Exit(1)
		}
		
		var current *session.Session
		if len(args) > 0 {
			taskName := strings.Join(args, " ")
			current, err = store.GetSessionByTask(taskName)
			if err != nil {
				fmt.Fprintf(os.Stderr, "Error: %v\n", err)
				os.Exit(1)
			}
		} else {
			current, err = store.GetCurrentSession()
			if err != nil {
				fmt.Fprintf(os.Stderr, "Error: Failed to get current session: %v\n", err)
				os.Exit(1)
			}
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

