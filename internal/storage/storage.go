package storage

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"tardis/internal/session"
)

type Storage struct {
	storagePath      string
	sessionsPath     string
	currentSessionPath string
}

func New(storagePath string) (*Storage, error) {
	s := &Storage{
		storagePath:        storagePath,
		sessionsPath:       filepath.Join(storagePath, "sessions"),
		currentSessionPath: filepath.Join(storagePath, "current_session.json"),
	}
	
	if err := s.ensureStorageExists(); err != nil {
		return nil, err
	}
	
	return s, nil
}

func (s *Storage) ensureStorageExists() error {
	if err := os.MkdirAll(s.storagePath, 0755); err != nil {
		return fmt.Errorf("failed to create storage directory: %w", err)
	}
	
	if err := os.MkdirAll(s.sessionsPath, 0755); err != nil {
		return fmt.Errorf("failed to create sessions directory: %w", err)
	}
	
	return nil
}

func (s *Storage) SaveCurrentSession(sess *session.Session) error {
	data, err := json.MarshalIndent(sess, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal session: %w", err)
	}
	
	if err := os.WriteFile(s.currentSessionPath, data, 0644); err != nil {
		return fmt.Errorf("failed to write current session: %w", err)
	}
	
	return nil
}

func (s *Storage) GetCurrentSession() (*session.Session, error) {
	if _, err := os.Stat(s.currentSessionPath); os.IsNotExist(err) {
		return nil, nil
	}
	
	data, err := os.ReadFile(s.currentSessionPath)
	if err != nil {
		return nil, fmt.Errorf("failed to read current session: %w", err)
	}
	
	var sess session.Session
	if err := json.Unmarshal(data, &sess); err != nil {
		return nil, fmt.Errorf("failed to unmarshal session: %w", err)
	}
	
	return &sess, nil
}

func (s *Storage) ArchiveSession(sess *session.Session) error {
	if !sess.IsEnded() {
		return fmt.Errorf("cannot archive a session that has not ended")
	}
	
	date := time.Unix(sess.StartTime, 0).Format("2006-01-02")
	filename := fmt.Sprintf("%s_%s.json", date, sess.ID)
	filepath := filepath.Join(s.sessionsPath, filename)
	
	data, err := json.MarshalIndent(sess, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal session: %w", err)
	}
	
	if err := os.WriteFile(filepath, data, 0644); err != nil {
		return fmt.Errorf("failed to write archived session: %w", err)
	}
	
	// Remove current session file
	if err := os.Remove(s.currentSessionPath); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("failed to remove current session: %w", err)
	}
	
	return nil
}

func (s *Storage) GetSessionsByDate(date string) ([]*session.Session, error) {
	pattern := filepath.Join(s.sessionsPath, date+"_*.json")
	matches, err := filepath.Glob(pattern)
	if err != nil {
		return nil, fmt.Errorf("failed to glob sessions: %w", err)
	}
	
	var sessions []*session.Session
	for _, match := range matches {
		data, err := os.ReadFile(match)
		if err != nil {
			continue
		}
		
		var sess session.Session
		if err := json.Unmarshal(data, &sess); err != nil {
			continue
		}
		
		sessions = append(sessions, &sess)
	}
	
	// Sort by start time
	sort.Slice(sessions, func(i, j int) bool {
		return sessions[i].StartTime < sessions[j].StartTime
	})
	
	return sessions, nil
}

func (s *Storage) GetAllSessions() ([]*session.Session, error) {
	pattern := filepath.Join(s.sessionsPath, "*_*.json")
	matches, err := filepath.Glob(pattern)
	if err != nil {
		return nil, fmt.Errorf("failed to glob sessions: %w", err)
	}
	
	var sessions []*session.Session
	for _, match := range matches {
		data, err := os.ReadFile(match)
		if err != nil {
			continue
		}
		
		var sess session.Session
		if err := json.Unmarshal(data, &sess); err != nil {
			continue
		}
		
		sessions = append(sessions, &sess)
	}
	
	// Sort by start time (newest first)
	sort.Slice(sessions, func(i, j int) bool {
		return sessions[i].StartTime > sessions[j].StartTime
	})
	
	return sessions, nil
}

func (s *Storage) GetStoragePath() string {
	return s.storagePath
}

func (s *Storage) GetSessionsPath() string {
	return s.sessionsPath
}

// GetDateFromFilename extracts the date from a session filename
func GetDateFromFilename(filename string) string {
	parts := strings.Split(filename, "_")
	if len(parts) > 0 {
		return parts[0]
	}
	return ""
}

