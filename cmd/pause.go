package cmd

import (
	"fmt"
	"os"
	"strings"

	"tardis/internal/session"
	"tardis/internal/storage"

	"github.com/spf13/cobra"
)

var pauseCmd = &cobra.Command{
	Use:   "pause [task]",
	Short: "Pause a work session",
	Long:  `Pause a work session. If no task name is provided, pauses the most recent session. Time will not be counted while paused.`,
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
				// Show available tasks to help user
				allSessions, listErr := store.GetAllActiveSessions()
				if listErr == nil && len(allSessions) > 0 {
					fmt.Fprintf(os.Stderr, "Available tasks:\n")
					for i, sess := range allSessions {
						fmt.Fprintf(os.Stderr, "  %d. %s\n", i+1, sess.Task)
					}
				}
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
			fmt.Fprintf(os.Stderr, "Error: No active session found.\n")
			os.Exit(1)
		}
		
		if current.IsPaused {
			fmt.Fprintf(os.Stderr, "Error: Session is already paused.\n")
			os.Exit(1)
		}
		
		current.Pause()
		
		if err := store.SaveCurrentSession(current); err != nil {
			fmt.Fprintf(os.Stderr, "Error: Failed to save session: %v\n", err)
			os.Exit(1)
		}
		
		fmt.Println("Session paused.")
		fmt.Printf("Task: %s\n", current.Task)
		fmt.Printf("Duration before pause: %s\n", current.GetFormattedDuration())
	},
}

