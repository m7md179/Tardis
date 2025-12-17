package cmd

import (
	"fmt"
	"os"
	"strings"
	"time"

	"tardis/internal/session"
	"tardis/internal/storage"

	"github.com/spf13/cobra"
)

var startCmd = &cobra.Command{
	Use:   "start [task]",
	Short: "Start a new work session",
	Long:  `Start a new work session with an optional task description.`,
	Args:  cobra.MinimumNArgs(1),
	Run: func(cmd *cobra.Command, args []string) {
		task := strings.Join(args, " ")
		
		store, err := storage.New(getStoragePath())
		if err != nil {
			fmt.Fprintf(os.Stderr, "Error: Failed to initialize storage: %v\n", err)
			os.Exit(1)
		}
		
		sess := session.NewSession(task)
		
		if err := store.SaveCurrentSession(sess); err != nil {
			fmt.Fprintf(os.Stderr, "Error: Failed to save session: %v\n", err)
			os.Exit(1)
		}
		
		fmt.Println("Session started!")
		fmt.Printf("Task: %s\n", sess.Task)
		fmt.Printf("Started at: %s\n", formatTime(sess.StartTime))
	},
}

func formatTime(timestamp int64) string {
	return fmt.Sprintf("%s", time.Unix(timestamp, 0).Format("2006-01-02 15:04:05"))
}

