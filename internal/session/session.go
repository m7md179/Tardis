package session

import (
	"fmt"
	"time"
)

type Pause struct {
	Start    int64 `json:"start"`
	End      int64 `json:"end"`
	Duration int64 `json:"duration"`
}

type Session struct {
	ID              string   `json:"id"`
	Task            string   `json:"task"`
	StartTime       int64    `json:"startTime"`
	EndTime         *int64   `json:"endTime,omitempty"`
	Pauses          []Pause  `json:"pauses"`
	TotalPausedTime int64    `json:"totalPausedTime"`
	IsPaused        bool     `json:"isPaused"`
	PauseStartTime  *int64   `json:"pauseStartTime,omitempty"`
}

func NewSession(task string) *Session {
	return &Session{
		ID:        generateID(),
		Task:      task,
		StartTime: time.Now().Unix(),
		Pauses:    []Pause{},
	}
}

func (s *Session) Pause() {
	if !s.IsPaused && !s.IsEnded() {
		s.IsPaused = true
		now := time.Now().Unix()
		s.PauseStartTime = &now
	}
}

func (s *Session) Resume() {
	if s.IsPaused && s.PauseStartTime != nil {
		now := time.Now().Unix()
		pauseDuration := now - *s.PauseStartTime
		
		s.Pauses = append(s.Pauses, Pause{
			Start:    *s.PauseStartTime,
			End:      now,
			Duration: pauseDuration,
		})
		
		s.TotalPausedTime += pauseDuration
		s.IsPaused = false
		s.PauseStartTime = nil
	}
}

func (s *Session) End() {
	if s.IsPaused {
		s.Resume()
	}
	now := time.Now().Unix()
	s.EndTime = &now
}

func (s *Session) IsEnded() bool {
	return s.EndTime != nil
}

func (s *Session) GetDuration() int64 {
	var endTime int64
	if s.EndTime != nil {
		endTime = *s.EndTime
	} else {
		endTime = time.Now().Unix()
	}
	
	elapsed := endTime - s.StartTime
	
	// If currently paused, don't count the current pause
	if s.IsPaused && s.PauseStartTime != nil {
		elapsed -= (time.Now().Unix() - *s.PauseStartTime)
	}
	
	duration := elapsed - s.TotalPausedTime
	if duration < 0 {
		return 0
	}
	return duration
}

func (s *Session) GetFormattedDuration() string {
	seconds := s.GetDuration()
	hours := seconds / 3600
	minutes := (seconds % 3600) / 60
	secs := seconds % 60
	
	if hours > 0 {
		return fmt.Sprintf("%d:%02d:%02d", hours, minutes, secs)
	}
	
	return fmt.Sprintf("%d:%02d", minutes, secs)
}

func generateID() string {
	return fmt.Sprintf("session_%d", time.Now().UnixNano())
}

