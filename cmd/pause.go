package cmd

import (
	"fmt"
	"os"

	"github.com/spf13/cobra"
	"tardis/internal/storage"
)

var pauseCmd = &cobra.Command{
	Use:   "pause",
	Short: "Pause the current work session",
	Long:  `Pause the current work session. Time will not be counted while paused.`,
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

