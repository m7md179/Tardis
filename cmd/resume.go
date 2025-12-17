package cmd

import (
	"fmt"
	"os"
	"strings"

	"tardis/internal/session"
	"tardis/internal/storage"

	"github.com/spf13/cobra"
)

var resumeCmd = &cobra.Command{
	Use:   "resume [task]",
	Short: "Resume a paused work session",
	Long:  `Resume a paused work session. If no task name is provided, resumes the most recent paused session. Time tracking will continue.`,
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
			fmt.Fprintf(os.Stderr, "Error: No active session found.\n")
			os.Exit(1)
		}
		
		if !current.IsPaused {
			fmt.Fprintf(os.Stderr, "Error: Session is not paused.\n")
			os.Exit(1)
		}
		
		current.Resume()
		
		if err := store.SaveCurrentSession(current); err != nil {
			fmt.Fprintf(os.Stderr, "Error: Failed to save session: %v\n", err)
			os.Exit(1)
		}
		
		fmt.Println("Session resumed.")
		fmt.Printf("Task: %s\n", current.Task)
		fmt.Printf("Current duration: %s\n", current.GetFormattedDuration())
	},
}

