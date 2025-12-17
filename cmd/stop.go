package cmd

import (
	"fmt"
	"os"
	"strings"

	"tardis/internal/session"
	"tardis/internal/storage"

	"github.com/spf13/cobra"
)

var noSync bool

var stopCmd = &cobra.Command{
	Use:   "stop [task]",
	Short: "Stop a work session",
	Long:  `Stop a work session and archive it. If no task name is provided, stops the most recent session. Optionally sync to Google Sheets.`,
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
		
		current.End()
		
		if err := store.ArchiveSession(current); err != nil {
			fmt.Fprintf(os.Stderr, "Error: Failed to archive session: %v\n", err)
			os.Exit(1)
		}
		
		fmt.Println("Session stopped!")
		fmt.Printf("Task: %s\n", current.Task)
		fmt.Printf("Duration: %s\n", current.GetFormattedDuration())
		if current.EndTime != nil {
			fmt.Printf("Ended at: %s\n", formatTime(*current.EndTime))
		}
		
		// Sync to Google Sheets if enabled
		if !noSync {
			if err := syncToSheets(store, current); err != nil {
				fmt.Fprintf(os.Stderr, "Warning: Failed to sync to Google Sheets: %v\n", err)
			} else {
				fmt.Println("✓ Synced to Google Sheets")
			}
		}
	},
}

func init() {
	stopCmd.Flags().BoolVar(&noSync, "no-sync", false, "Skip syncing to Google Sheets")
}

