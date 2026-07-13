package jwt_test

import (
	"encoding/base64"
	"testing"

	"github.com/AthenZ/athenzd/internal/jwt"
)

// makeJWT builds a fake JWT with the given payload segment (header and signature are dummy).
func makeJWT(payloadJSON string) string {
	header := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"RS256","typ":"JWT"}`))
	payload := base64.RawURLEncoding.EncodeToString([]byte(payloadJSON))
	return header + "." + payload + ".dummy-signature"
}

// TestDecode_Valid checks that a standard payload decodes all displayed claims.
func TestDecode_Valid(t *testing.T) {
	token := makeJWT(`{
		"iss": "https://localhost:34444/realms/master",
		"sub": "abc-123",
		"aud": "athenzd",
		"preferred_username": "idjag-learner",
		"email": "idjag-learner@athenz.io",
		"name": "ID-JAG Learner",
		"iat": 1783668980,
		"exp": 1783669280
	}`)

	c, err := jwt.Decode(token)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if c.Issuer != "https://localhost:34444/realms/master" {
		t.Errorf("unexpected iss: %q", c.Issuer)
	}
	if c.Subject != "abc-123" {
		t.Errorf("unexpected sub: %q", c.Subject)
	}
	if c.Audience != "athenzd" {
		t.Errorf("unexpected aud: %q", c.Audience)
	}
	if c.PreferredUsername != "idjag-learner" {
		t.Errorf("unexpected preferred_username: %q", c.PreferredUsername)
	}
	if c.Email != "idjag-learner@athenz.io" {
		t.Errorf("unexpected email: %q", c.Email)
	}
	if c.Name != "ID-JAG Learner" {
		t.Errorf("unexpected name: %q", c.Name)
	}
	if c.IssuedAt != 1783668980 {
		t.Errorf("unexpected iat: %d", c.IssuedAt)
	}
	if c.Expiry != 1783669280 {
		t.Errorf("unexpected exp: %d", c.Expiry)
	}
	// Raw should carry every claim.
	if c.Raw["preferred_username"] != "idjag-learner" {
		t.Errorf("Raw missing preferred_username: %v", c.Raw)
	}
}

// TestDecode_AudienceArray checks that an aud array is joined into a single string.
func TestDecode_AudienceArray(t *testing.T) {
	token := makeJWT(`{"aud": ["athenzd", "account"]}`)
	c, err := jwt.Decode(token)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if c.Audience != "athenzd, account" {
		t.Errorf("expected joined audience, got: %q", c.Audience)
	}
}

// TestDecode_AudienceInvalid checks that an aud that is neither string nor array errors.
func TestDecode_AudienceInvalid(t *testing.T) {
	token := makeJWT(`{"aud": 12345}`)
	_, err := jwt.Decode(token)
	if err == nil {
		t.Fatal("expected error for numeric aud, got nil")
	}
}

// TestDecode_WrongSegmentCount checks that a token without 3 segments errors.
func TestDecode_WrongSegmentCount(t *testing.T) {
	_, err := jwt.Decode("only.two")
	if err == nil {
		t.Fatal("expected error for 2-segment token, got nil")
	}
}

// TestDecode_BadBase64 checks that an undecodable payload segment errors.
func TestDecode_BadBase64(t *testing.T) {
	_, err := jwt.Decode("header.!!!not-base64!!!.sig")
	if err == nil {
		t.Fatal("expected error for bad base64 payload, got nil")
	}
}

// TestDecode_BadJSON checks that a payload that is not JSON errors.
func TestDecode_BadJSON(t *testing.T) {
	payload := base64.RawURLEncoding.EncodeToString([]byte("not json"))
	_, err := jwt.Decode("header." + payload + ".sig")
	if err == nil {
		t.Fatal("expected error for non-JSON payload, got nil")
	}
}
