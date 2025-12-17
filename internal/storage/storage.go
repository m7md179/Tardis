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
	storagePath        string
	sessionsPath       string
	activeSessionsPath string
	currentSessionPath string
}

func New(storagePath string) (*Storage, error) {
	s := &Storage{
		storagePath:        storagePath,
		sessionsPath:       filepath.Join(storagePath, "sessions"),
		activeSessionsPath: filepath.Join(storagePath, "active_sessions"),
		currentSessionPath: filepath.Join(storagePath, "current_session.json"),
	}
	
	if err := s.ensureStorageExists(); err != nil {
		return nil, err
	}
	
	// Migrate old current_session.json to active_sessions if it exists
	if err := s.migrateOldSession(); err != nil {
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
	
	if err := os.MkdirAll(s.activeSessionsPath, 0755); err != nil {
		return fmt.Errorf("failed to create active sessions directory: %w", err)
	}
	
	return nil
}

// migrateOldSession migrates the old current_session.json to the new active_sessions directory
func (s *Storage) migrateOldSession() error {
	if _, err := os.Stat(s.currentSessionPath); os.IsNotExist(err) {
		return nil
	}
	
	data, err := os.ReadFile(s.currentSessionPath)
	if err != nil {
		return nil // If we can't read it, just continue
	}
	
	var sess session.Session
	if err := json.Unmarshal(data, &sess); err != nil {
		return nil // If we can't parse it, just continue
	}
	
	// Only migrate if the session is not ended
	if !sess.IsEnded() {
		// Save to active sessions
		activePath := filepath.Join(s.activeSessionsPath, sess.ID+".json")
		if err := os.WriteFile(activePath, data, 0644); err != nil {
			return fmt.Errorf("failed to migrate old session: %w", err)
		}
	}
	
	// Remove old current_session.json
	os.Remove(s.currentSessionPath)
	
	return nil
}

func (s *Storage) SaveCurrentSession(sess *session.Session) error {
	data, err := json.MarshalIndent(sess, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal session: %w", err)
	}
	
	// Save to active sessions directory
	activePath := filepath.Join(s.activeSessionsPath, sess.ID+".json")
	if err := os.WriteFile(activePath, data, 0644); err != nil {
		return fmt.Errorf("failed to write active session: %w", err)
	}
	
	return nil
}

func (s *Storage) GetCurrentSession() (*session.Session, error) {
	// For backward compatibility, return the most recent active session
	activeSessions, err := s.GetAllActiveSessions()
	if err != nil {
		return nil, err
	}
	
	if len(activeSessions) == 0 {
		return nil, nil
	}
	
	// Return the most recently started session
	return activeSessions[0], nil
}

func (s *Storage) GetAllActiveSessions() ([]*session.Session, error) {
	pattern := filepath.Join(s.activeSessionsPath, "*.json")
	matches, err := filepath.Glob(pattern)
	if err != nil {
		return nil, fmt.Errorf("failed to glob active sessions: %w", err)
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
		
		// Only include sessions that are not ended
		if !sess.IsEnded() {
			sessions = append(sessions, &sess)
		}
	}
	
	// Sort by start time (newest first)
	sort.Slice(sessions, func(i, j int) bool {
		return sessions[i].StartTime > sessions[j].StartTime
	})
	
	return sessions, nil
}

func (s *Storage) GetSessionByTask(taskName string) (*session.Session, error) {
	activeSessions, err := s.GetAllActiveSessions()
	if err != nil {
		return nil, err
	}
	
	if len(activeSessions) == 0 {
		return nil, fmt.Errorf("no active sessions found")
	}
	
	taskName = strings.TrimSpace(taskName)
	if taskName == "" {
		return nil, fmt.Errorf("task name cannot be empty")
	}
	
	// Try exact match first (case-sensitive)
	for _, sess := range activeSessions {
		if sess.Task == taskName {
			return sess, nil
		}
	}
	
	// Try exact match (case-insensitive)
	taskNameLower := strings.ToLower(taskName)
	var exactMatches []*session.Session
	for _, sess := range activeSessions {
		sessTaskTrimmed := strings.TrimSpace(sess.Task)
		sessTaskLower := strings.ToLower(sessTaskTrimmed)
		if sessTaskLower == taskNameLower {
			exactMatches = append(exactMatches, sess)
		}
	}
	
	// If we have exactly one exact match, return it
	if len(exactMatches) == 1 {
		return exactMatches[0], nil
	}
	
	// If multiple exact matches (shouldn't happen, but handle it)
	if len(exactMatches) > 1 {
		var taskNames []string
		for _, m := range exactMatches {
			taskNames = append(taskNames, m.Task)
		}
		return nil, fmt.Errorf("multiple sessions with exact match '%s': %v", taskName, taskNames)
	}
	
	// Try prefix match: only if search term is shorter and task starts with it
	// This allows "test" to match "test3", but "test3" won't match "test4"
	var prefixMatches []*session.Session
	for _, sess := range activeSessions {
		sessTaskTrimmed := strings.TrimSpace(sess.Task)
		sessTaskLower := strings.ToLower(sessTaskTrimmed)
		// Only match if task name is longer and starts with search term
		if len(sessTaskLower) > len(taskNameLower) && strings.HasPrefix(sessTaskLower, taskNameLower) {
			prefixMatches = append(prefixMatches, sess)
		}
	}
	
	// If we have exactly one prefix match, return it
	if len(prefixMatches) == 1 {
		return prefixMatches[0], nil
	}
	
	// If multiple prefix matches, show error
	if len(prefixMatches) > 1 {
		var taskNames []string
		for _, m := range prefixMatches {
			taskNames = append(taskNames, m.Task)
		}
		return nil, fmt.Errorf("multiple sessions match prefix '%s': %v. Please be more specific.", taskName, taskNames)
	}
	
	// If no match, show helpful error with available tasks
	var taskNames []string
	for _, sess := range activeSessions {
		taskNames = append(taskNames, sess.Task)
	}
	return nil, fmt.Errorf("no active session found with task '%s'. Available tasks: %v", taskName, taskNames)
	
	return nil, fmt.Errorf("no active session found with task matching '%s'", taskName)
}

func (s *Storage) ArchiveSession(sess *session.Session) error {
	if !sess.IsEnded() {
		return fmt.Errorf("cannot archive a session that has not ended")
	}
	
	date := time.Unix(sess.StartTime, 0).Format("2006-01-02")
	filename := fmt.Sprintf("%s_%s.json", date, sess.ID)
	archivePath := filepath.Join(s.sessionsPath, filename)
	
	data, err := json.MarshalIndent(sess, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal session: %w", err)
	}
	
	if err := os.WriteFile(archivePath, data, 0644); err != nil {
		return fmt.Errorf("failed to write archived session: %w", err)
	}
	
	// Remove from active sessions
	activePath := filepath.Join(s.activeSessionsPath, sess.ID+".json")
	if err := os.Remove(activePath); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("failed to remove active session: %w", err)
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

// DeleteSessionByTask deletes a session (active or archived) by task name
func (s *Storage) DeleteSessionByTask(taskName string) error {
	taskName = strings.TrimSpace(taskName)
	if taskName == "" {
		return fmt.Errorf("task name cannot be empty")
	}

	// First, try to find and delete from active sessions
	activeSessions, err := s.GetAllActiveSessions()
	if err != nil {
		return fmt.Errorf("failed to get active sessions: %w", err)
	}

	taskNameLower := strings.ToLower(taskName)
	for _, sess := range activeSessions {
		sessTaskTrimmed := strings.TrimSpace(sess.Task)
		sessTaskLower := strings.ToLower(sessTaskTrimmed)
		if sessTaskLower == taskNameLower {
			activePath := filepath.Join(s.activeSessionsPath, sess.ID+".json")
			if err := os.Remove(activePath); err != nil {
				return fmt.Errorf("failed to delete active session: %w", err)
			}
			return nil
		}
	}

	// If not found in active sessions, search archived sessions
	allSessions, err := s.GetAllSessions()
	if err != nil {
		return fmt.Errorf("failed to get archived sessions: %w", err)
	}

	for _, sess := range allSessions {
		sessTaskTrimmed := strings.TrimSpace(sess.Task)
		sessTaskLower := strings.ToLower(sessTaskTrimmed)
		if sessTaskLower == taskNameLower {
			// Find the file in archived sessions
			pattern := filepath.Join(s.sessionsPath, "*_"+sess.ID+".json")
			matches, err := filepath.Glob(pattern)
			if err != nil {
				return fmt.Errorf("failed to find archived session file: %w", err)
			}
			if len(matches) > 0 {
				if err := os.Remove(matches[0]); err != nil {
					return fmt.Errorf("failed to delete archived session: %w", err)
				}
				return nil
			}
		}
	}

	return fmt.Errorf("no session found with task '%s'", taskName)
}

// WipeAllSessions deletes all active and archived sessions
func (s *Storage) WipeAllSessions() error {
	// Delete all active sessions
	pattern := filepath.Join(s.activeSessionsPath, "*.json")
	matches, err := filepath.Glob(pattern)
	if err != nil {
		return fmt.Errorf("failed to glob active sessions: %w", err)
	}
	for _, match := range matches {
		if err := os.Remove(match); err != nil {
			return fmt.Errorf("failed to delete active session file %s: %w", match, err)
		}
	}

	// Delete all archived sessions
	pattern = filepath.Join(s.sessionsPath, "*.json")
	matches, err = filepath.Glob(pattern)
	if err != nil {
		return fmt.Errorf("failed to glob archived sessions: %w", err)
	}
	for _, match := range matches {
		if err := os.Remove(match); err != nil {
			return fmt.Errorf("failed to delete archived session file %s: %w", match, err)
		}
	}

	return nil
}

// GetDateFromFilename extracts the date from a session filename
func GetDateFromFilename(filename string) string {
	parts := strings.Split(filename, "_")
	if len(parts) > 0 {
		return parts[0]
	}
	return ""
}

