package cmd

import (
	"fmt"
	"os"

	"github.com/spf13/cobra"
)

var rootCmd = &cobra.Command{
	Use:   "tardis",
	Short: "A lightweight, offline-first CLI tool for tracking focused work time",
	Long: `TARDIS is a lightweight, offline-first CLI tool for tracking focused work time.
It lets you start, pause, resume, and end work sessions directly from the terminal,
automatically recording how long each task takes throughout the day.`,
}

func Execute() error {
	return rootCmd.Execute()
}

func init() {
	rootCmd.AddCommand(startCmd)
	rootCmd.AddCommand(stopCmd)
	rootCmd.AddCommand(pauseCmd)
	rootCmd.AddCommand(resumeCmd)
	rootCmd.AddCommand(statusCmd)
	rootCmd.AddCommand(logCmd)
	rootCmd.AddCommand(authCmd)
	rootCmd.AddCommand(configCmd)
}

func getStoragePath() string {
	home, err := os.UserHomeDir()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error: Unable to determine home directory: %v\n", err)
		os.Exit(1)
	}
	return home + "/.tardis"
}

