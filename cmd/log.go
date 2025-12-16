package cmd

import (
	"fmt"
	"os"
	"sort"
	"time"

	"github.com/spf13/cobra"
	"tardis/internal/session"
	"tardis/internal/storage"
)

var logCmd = &cobra.Command{
	Use:   "log [date|all]",
	Short: "View work session logs",
	Long:  `View logs for today, a specific date (YYYY-MM-DD), or all historical logs.`,
	Args:  cobra.MaximumNArgs(1),
	Run: func(cmd *cobra.Command, args []string) {
		store, err := storage.New(getStoragePath())
		if err != nil {
			fmt.Fprintf(os.Stderr, "Error: Failed to initialize storage: %v\n", err)
			os.Exit(1)
		}
		
		var sessions []*session.Session
		var date string
		
		if len(args) == 0 || args[0] == "" {
			// Today's logs
			date = time.Now().Format("2006-01-02")
			sessions, err = store.GetSessionsByDate(date)
			if err != nil {
				fmt.Fprintf(os.Stderr, "Error: Failed to get sessions: %v\n", err)
				os.Exit(1)
			}
		} else if args[0] == "all" {
			// All historical logs
			sessions, err = store.GetAllSessions()
			if err != nil {
				fmt.Fprintf(os.Stderr, "Error: Failed to get sessions: %v\n", err)
				os.Exit(1)
			}
		} else {
			// Specific date
			date = args[0]
			_, err := time.Parse("2006-01-02", date)
			if err != nil {
				fmt.Fprintf(os.Stderr, "Error: Invalid date format. Use YYYY-MM-DD\n")
				os.Exit(1)
			}
			sessions, err = store.GetSessionsByDate(date)
			if err != nil {
				fmt.Fprintf(os.Stderr, "Error: Failed to get sessions: %v\n", err)
				os.Exit(1)
			}
		}
		
		if len(sessions) == 0 {
			if date != "" {
				fmt.Printf("No sessions found for %s\n", date)
			} else {
				fmt.Println("No sessions found")
			}
			return
		}
		
		// Group sessions by date for "all" view
		if len(args) > 0 && args[0] == "all" {
			sessionsByDate := make(map[string][]*session.Session)
			for _, sess := range sessions {
				sessDate := time.Unix(sess.StartTime, 0).Format("2006-01-02")
				sessionsByDate[sessDate] = append(sessionsByDate[sessDate], sess)
			}
			
			// Sort dates (newest first)
			var dates []string
			for d := range sessionsByDate {
				dates = append(dates, d)
			}
			sort.Sort(sort.Reverse(sort.StringSlice(dates)))
			
			for _, d := range dates {
				printSessionsForDate(d, sessionsByDate[d])
			}
		} else {
			printSessionsForDate(date, sessions)
		}
	},
}

func printSessionsForDate(date string, sessions []*session.Session) {
	fmt.Printf("\nSessions for %s:\n\n", date)
	
	var totalSeconds int64
	for _, sess := range sessions {
		if sess.EndTime == nil {
			continue
		}
		
		startTime := time.Unix(sess.StartTime, 0)
		endTime := time.Unix(*sess.EndTime, 0)
		
		fmt.Printf("  Task: %s\n", sess.Task)
		fmt.Printf("  Time: %s - %s\n", 
			startTime.Format("15:04:05"), 
			endTime.Format("15:04:05"))
		fmt.Printf("  Duration: %s\n\n", sess.GetFormattedDuration())
		
		totalSeconds += sess.GetDuration()
	}
	
	if totalSeconds > 0 {
		hours := totalSeconds / 3600
		minutes := (totalSeconds % 3600) / 60
		if hours > 0 {
			fmt.Printf("Total time: %d:%02d\n", hours, minutes)
		} else {
			fmt.Printf("Total time: %d:%02d\n", minutes, totalSeconds%60)
		}
	}
}

