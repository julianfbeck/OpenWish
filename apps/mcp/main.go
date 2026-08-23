// openwish-mcp exposes OpenWish projects, features, issues, and private notes
// to coding agents over MCP stdio. Credentials are read only from the process
// environment and are never included in tool output.
package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

type request struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id,omitempty"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params,omitempty"`
}

type response struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id,omitempty"`
	Result  any             `json:"result,omitempty"`
	Error   any             `json:"error,omitempty"`
}

type server struct {
	baseURL string
	apiKey  string
	http    *http.Client
}

func main() {
	s := &server{
		baseURL: strings.TrimRight(envOr("OPENWISH_API_URL", "https://wishkit.juli.sh"), "/"),
		apiKey:  os.Getenv("OPENWISH_API_KEY"),
		http:    &http.Client{Timeout: 30 * time.Second},
	}
	scanner := bufio.NewScanner(os.Stdin)
	scanner.Buffer(make([]byte, 64*1024), 4*1024*1024)
	encoder := json.NewEncoder(os.Stdout)
	for scanner.Scan() {
		var req request
		if err := json.Unmarshal(scanner.Bytes(), &req); err != nil {
			_ = encoder.Encode(response{JSONRPC: "2.0", Error: map[string]any{"code": -32700, "message": "Parse error"}})
			continue
		}
		if len(req.ID) == 0 { // notifications need no response
			continue
		}
		_ = encoder.Encode(s.handle(req))
	}
}

func (s *server) handle(req request) response {
	ok := func(result any) response { return response{JSONRPC: "2.0", ID: req.ID, Result: result} }
	switch req.Method {
	case "initialize":
		return ok(map[string]any{
			"protocolVersion": "2025-11-25",
			"capabilities":    map[string]any{"tools": map[string]any{"listChanged": false}},
			"serverInfo":      map[string]string{"name": "openwish", "version": "2.0.0"},
			"instructions":    "Read OpenWish feedback and add private implementation notes. Never expose OPENWISH_API_KEY.",
		})
	case "server/discover":
		return ok(map[string]any{
			"protocolVersion": "2026-07-28",
			"serverInfo":      map[string]string{"name": "openwish", "version": "2.0.0"},
			"capabilities":    map[string]any{"tools": map[string]any{}},
		})
	case "ping":
		return ok(map[string]any{})
	case "tools/list":
		return ok(map[string]any{"tools": tools()})
	case "tools/call":
		return ok(s.callTool(req.Params))
	default:
		return response{JSONRPC: "2.0", ID: req.ID, Error: map[string]any{"code": -32601, "message": "Method not found"}}
	}
}

func tools() []map[string]any {
	object := func(properties map[string]any, required ...string) map[string]any {
		schema := map[string]any{"type": "object", "properties": properties, "additionalProperties": false}
		if len(required) > 0 {
			schema["required"] = required
		}
		return schema
	}
	str := func(description string) map[string]any {
		return map[string]any{"type": "string", "description": description}
	}
	return []map[string]any{
		{"name": "openwish_list_projects", "description": "List OpenWish projects.", "inputSchema": object(map[string]any{})},
		{"name": "openwish_list_features", "description": "List feature requests for a project, including state, votes, and comments.", "inputSchema": object(map[string]any{"project": str("Project slug")}, "project")},
		{"name": "openwish_list_issues", "description": "List bugs and card-data issues with diagnostic context and selected card data.", "inputSchema": object(map[string]any{"project": str("Project slug")}, "project")},
		{"name": "openwish_add_issue_note", "description": "Add a private implementation note to an issue. Notes are for maintainers and are not emailed to reporters.", "inputSchema": object(map[string]any{"project": str("Project slug"), "issueId": str("Issue UUID"), "body": str("Private note")}, "project", "issueId", "body")},
	}
}

func (s *server) callTool(raw json.RawMessage) map[string]any {
	var params struct {
		Name      string         `json:"name"`
		Arguments map[string]any `json:"arguments"`
	}
	if err := json.Unmarshal(raw, &params); err != nil {
		return toolError("Invalid tool arguments.")
	}
	if s.apiKey == "" {
		return toolError("OPENWISH_API_KEY is not configured for this MCP server.")
	}
	project, _ := params.Arguments["project"].(string)
	var method, path string
	var body any
	switch params.Name {
	case "openwish_list_projects":
		method, path = http.MethodGet, "/api/v1/projects"
	case "openwish_list_features":
		method, path = http.MethodGet, "/api/v1/projects/"+url.PathEscape(project)+"/wishes"
	case "openwish_list_issues":
		method, path = http.MethodGet, "/api/v1/projects/"+url.PathEscape(project)+"/bugs"
	case "openwish_add_issue_note":
		issueID, _ := params.Arguments["issueId"].(string)
		note, _ := params.Arguments["body"].(string)
		method = http.MethodPost
		path = "/api/v2/projects/" + url.PathEscape(project) + "/issues/" + url.PathEscape(issueID) + "/notes"
		body = map[string]string{"body": note}
	default:
		return toolError("Unknown OpenWish tool.")
	}
	payload, err := s.request(method, path, body)
	if err != nil {
		return toolError(err.Error())
	}
	var structured any
	if err := json.Unmarshal(payload, &structured); err != nil {
		return toolError("OpenWish returned invalid JSON.")
	}
	pretty, _ := json.MarshalIndent(structured, "", "  ")
	return map[string]any{
		"content":           []map[string]string{{"type": "text", "text": string(pretty)}},
		"structuredContent": structured,
		"isError":           false,
	}
}

func (s *server) request(method, path string, body any) ([]byte, error) {
	var reader io.Reader
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		reader = bytes.NewReader(data)
	}
	req, err := http.NewRequest(method, s.baseURL+path, reader)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+s.apiKey)
	req.Header.Set("Accept", "application/json")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := s.http.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("OpenWish API returned HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(data)))
	}
	return data, nil
}

func toolError(message string) map[string]any {
	return map[string]any{"content": []map[string]string{{"type": "text", "text": message}}, "isError": true}
}

func envOr(name, fallback string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}
	return fallback
}
