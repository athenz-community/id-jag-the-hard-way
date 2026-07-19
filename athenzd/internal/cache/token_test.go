package cache_test

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/AthenZ/athenzd/internal/cache"
)

// TestSaveLoad checks that a token written with Save is readable with Load.
func TestSaveLoad(t *testing.T) {
	t.Setenv("HOME", t.TempDir())

	entry := cache.TokenEntry{
		IDToken:   "eyJ.test.token",
		ExpiresAt: time.Now().Add(1 * time.Hour).UTC().Truncate(time.Second),
		IDJAGs: map[string]cache.IDJAGEntry{
			"athenz": {
				Service:   "athenz",
				Domain:    "gen-ai.services.athenz",
				Token:     "eyJ.id.jag",
				Scope:     "gen-ai.services.athenz:role.gen-ai-users",
				ExpiresAt: time.Now().Add(30 * time.Minute).UTC().Truncate(time.Second),
			},
		},
	}

	if err := cache.Save("my-service", entry); err != nil {
		t.Fatalf("Save failed: %v", err)
	}

	got, err := cache.Load("my-service")
	if err != nil {
		t.Fatalf("Load failed: %v", err)
	}

	if got.IDToken != entry.IDToken {
		t.Errorf("IDToken mismatch: got %q, want %q", got.IDToken, entry.IDToken)
	}
	if !got.ExpiresAt.Equal(entry.ExpiresAt) {
		t.Errorf("ExpiresAt mismatch: got %v, want %v", got.ExpiresAt, entry.ExpiresAt)
	}
	gotIDJAG, ok := got.IDJAGs["athenz"]
	wantIDJAG := entry.IDJAGs["athenz"]
	if !ok || gotIDJAG.Service != wantIDJAG.Service || gotIDJAG.Domain != wantIDJAG.Domain ||
		gotIDJAG.Token != wantIDJAG.Token || gotIDJAG.Scope != wantIDJAG.Scope ||
		!gotIDJAG.ExpiresAt.Equal(wantIDJAG.ExpiresAt) {
		t.Errorf("IDJAG mismatch: got %+v, want %+v", gotIDJAG, wantIDJAG)
	}
}

// TestPathFor checks that PathFor returns a path under ~/.cache/athenzd.
func TestPathFor(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)

	p, err := cache.PathFor("my-service")
	if err != nil {
		t.Fatalf("PathFor failed: %v", err)
	}
	expected := filepath.Join(home, ".cache", "athenzd", "my-service.json")
	if p != expected {
		t.Errorf("unexpected path: got %q, want %q", p, expected)
	}
}

// TestLoad_MissingFile checks that loading a non-existent cache returns an error.
func TestLoad_MissingFile(t *testing.T) {
	t.Setenv("HOME", t.TempDir())

	_, err := cache.Load("no-such-service")
	if err == nil {
		t.Fatal("expected error for missing cache file, got nil")
	}
}

// TestLoad_CorruptFile checks that a corrupt cache file returns a parse error.
func TestLoad_CorruptFile(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)

	cacheDir := filepath.Join(home, ".cache", "athenzd")
	if err := os.MkdirAll(cacheDir, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(cacheDir, "bad-service.json"), []byte("not-json"), 0600); err != nil {
		t.Fatal(err)
	}

	_, err := cache.Load("bad-service")
	if err == nil {
		t.Fatal("expected error for corrupt cache file, got nil")
	}
}

// TestIsExpired checks the expiry logic on a TokenEntry.
func TestIsExpired(t *testing.T) {
	expired := cache.TokenEntry{ExpiresAt: time.Now().Add(-1 * time.Second)}
	if !expired.IsExpired() {
		t.Error("expected expired token to be expired")
	}

	valid := cache.TokenEntry{ExpiresAt: time.Now().Add(1 * time.Hour)}
	if valid.IsExpired() {
		t.Error("expected valid token to not be expired")
	}
}

// TestLoad_HomeUnresolvable checks that Load returns an error when HOME is unset.
func TestLoad_HomeUnresolvable(t *testing.T) {
	t.Setenv("HOME", "")
	_, err := cache.Load("any-service")
	if err == nil {
		t.Fatal("expected error when HOME is unset, got nil")
	}
}

// TestSave_HomeUnresolvable checks that Save returns an error when HOME is unset.
func TestSave_HomeUnresolvable(t *testing.T) {
	t.Setenv("HOME", "")
	err := cache.Save("any-service", cache.TokenEntry{IDToken: "x"})
	if err == nil {
		t.Fatal("expected error when HOME is unset, got nil")
	}
}

// TestSave_UnwritablePath checks that Save returns an error if the path is unwritable.
func TestSave_UnwritablePath(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)

	// Create the cache dir as a file so WriteFile fails.
	cacheDir := filepath.Join(home, ".cache", "athenzd")
	if err := os.MkdirAll(filepath.Dir(cacheDir), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(cacheDir, []byte("i am a file not a dir"), 0600); err != nil {
		t.Fatal(err)
	}

	err := cache.Save("my-service", cache.TokenEntry{IDToken: "x"})
	if err == nil {
		t.Fatal("expected error writing to unwritable path, got nil")
	}
}
