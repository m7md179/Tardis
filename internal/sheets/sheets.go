package sheets

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"tardis/internal/session"

	"golang.org/x/oauth2"
	"golang.org/x/oauth2/google"
	"google.golang.org/api/option"
	"google.golang.org/api/sheets/v4"
)

const (
	credentialsFile = "credentials.json"
	tokenFile       = "token.json"
	configFile      = "sheets_config.json"
	scope           = "https://www.googleapis.com/auth/spreadsheets"
)

type Config struct {
	SpreadsheetID string `json:"spreadsheetId"`
}

func getCredentialsPath(storagePath string) string {
	return filepath.Join(storagePath, credentialsFile)
}

func getTokenPath(storagePath string) string {
	return filepath.Join(storagePath, tokenFile)
}

func getConfigPath(storagePath string) string {
	return filepath.Join(storagePath, configFile)
}

func IsConfigured(storagePath string) bool {
	credPath := getCredentialsPath(storagePath)
	tokenPath := getTokenPath(storagePath)
	configPath := getConfigPath(storagePath)
	
	return fileExists(credPath) && fileExists(tokenPath) && fileExists(configPath)
}

func fileExists(path string) bool {
	_, err := os.Stat(path)
	return !os.IsNotExist(err)
}

func HasCredentials(storagePath string) bool {
	credPath := getCredentialsPath(storagePath)
	return fileExists(credPath)
}

func GetAuthURL(storagePath string) (string, error) {
	credPath := getCredentialsPath(storagePath)
	
	b, err := os.ReadFile(credPath)
	if err != nil {
		return "", fmt.Errorf("unable to read credentials file: %w", err)
	}
	
	config, err := google.ConfigFromJSON(b, scope)
	if err != nil {
		return "", fmt.Errorf("unable to parse client secret file to config: %w", err)
	}
	
	authURL := config.AuthCodeURL("state-token", oauth2.AccessTypeOffline)
	return authURL, nil
}

func CompleteAuth(storagePath string, authCode string) error {
	credPath := getCredentialsPath(storagePath)
	tokenPath := getTokenPath(storagePath)
	
	b, err := os.ReadFile(credPath)
	if err != nil {
		return fmt.Errorf("unable to read credentials file: %w", err)
	}
	
	config, err := google.ConfigFromJSON(b, scope)
	if err != nil {
		return fmt.Errorf("unable to parse client secret file to config: %w", err)
	}
	
	tok, err := config.Exchange(context.Background(), authCode)
	if err != nil {
		return fmt.Errorf("unable to retrieve token from web: %w", err)
	}
	
	tokenData, err := json.Marshal(tok)
	if err != nil {
		return fmt.Errorf("unable to marshal token: %w", err)
	}
	
	if err := os.WriteFile(tokenPath, tokenData, 0600); err != nil {
		return fmt.Errorf("unable to cache token: %w", err)
	}
	
	return nil
}

func SaveConfig(storagePath string, spreadsheetID string) error {
	config := Config{
		SpreadsheetID: spreadsheetID,
	}
	
	configData, err := json.MarshalIndent(config, "", "  ")
	if err != nil {
		return fmt.Errorf("unable to marshal config: %w", err)
	}
	
	configPath := getConfigPath(storagePath)
	if err := os.WriteFile(configPath, configData, 0644); err != nil {
		return fmt.Errorf("unable to save config: %w", err)
	}
	
	return nil
}

func getConfig(storagePath string) (*Config, error) {
	configPath := getConfigPath(storagePath)
	
	data, err := os.ReadFile(configPath)
	if err != nil {
		return nil, fmt.Errorf("unable to read config: %w", err)
	}
	
	var config Config
	if err := json.Unmarshal(data, &config); err != nil {
		return nil, fmt.Errorf("unable to parse config: %w", err)
	}
	
	return &config, nil
}

func getClient(storagePath string) (*sheets.Service, error) {
	ctx := context.Background()
	credPath := getCredentialsPath(storagePath)
	tokenPath := getTokenPath(storagePath)
	
	b, err := os.ReadFile(credPath)
	if err != nil {
		return nil, fmt.Errorf("unable to read credentials file: %w", err)
	}
	
	config, err := google.ConfigFromJSON(b, scope)
	if err != nil {
		return nil, fmt.Errorf("unable to parse client secret file to config: %w", err)
	}
	
	tok, err := tokenFromFile(tokenPath)
	if err != nil {
		return nil, fmt.Errorf("unable to get token: %w", err)
	}
	
	client := config.Client(ctx, tok)
	srv, err := sheets.NewService(ctx, option.WithHTTPClient(client))
	if err != nil {
		return nil, fmt.Errorf("unable to retrieve Sheets client: %w", err)
	}
	
	return srv, nil
}

func tokenFromFile(file string) (*oauth2.Token, error) {
	f, err := os.Open(file)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	
	tok := &oauth2.Token{}
	err = json.NewDecoder(f).Decode(tok)
	return tok, err
}

func SyncSession(storagePath string, sess *session.Session) error {
	if !sess.IsEnded() || sess.EndTime == nil {
		return fmt.Errorf("cannot sync a session that has not ended")
	}
	
	config, err := getConfig(storagePath)
	if err != nil {
		return err
	}
	
	client, err := getClient(storagePath)
	if err != nil {
		return err
	}
	
	startTime := time.Unix(sess.StartTime, 0)
	endTime := time.Unix(*sess.EndTime, 0)
	duration := sess.GetDuration()
	
	values := [][]interface{}{
		{
			startTime.Format("2006-01-02"),
			startTime.Format("15:04:05"),
			endTime.Format("15:04:05"),
			sess.GetFormattedDuration(),
			fmt.Sprintf("%d", duration),
			sess.Task,
		},
	}
	
	valueRange := &sheets.ValueRange{
		Values: values,
	}
	
	spreadsheetId := config.SpreadsheetID
	range_ := "Sheet1!A2" // Append to row 2 (assuming row 1 has headers)
	
	_, err = client.Spreadsheets.Values.Append(
		spreadsheetId,
		range_,
		valueRange,
	).ValueInputOption("USER_ENTERED").InsertDataOption("INSERT_ROWS").Do()
	
	if err != nil {
		return fmt.Errorf("unable to append data to sheet: %w", err)
	}
	
	return nil
}

