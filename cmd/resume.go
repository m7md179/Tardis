package cmd

import (
	"fmt"
	"os"

	"github.com/spf13/cobra"
	"tardis/internal/storage"
)

var resumeCmd = &cobra.Command{
	Use:   "resume",
	Short: "Resume a paused work session",
	Long:  `Resume a paused work session. Time tracking will continue.`,
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

