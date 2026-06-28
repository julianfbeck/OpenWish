// Command openwish is a CLI for the OpenWish global API (/api/v1). It reads and
// writes feature requests and bug reports across every project using a single
// global API key.
//
// Configuration (flags override environment):
//
//	OPENWISH_API_URL   base URL of your OpenWish worker (default https://wishkit.juli.sh)
//	OPENWISH_API_KEY   the global API key (OPENWISH_GLOBAL_API_KEY on the server)
//
// Examples:
//
//	openwish projects list
//	openwish projects create --slug my-app --name "My App"
//	openwish wishes list --project my-app
//	openwish wishes create --project my-app --title "Dark mode" --description "Please add it"
//	openwish bugs list --project my-app
//	openwish bugs create --project my-app --title "Crash" --description "Crashes on launch"
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"text/tabwriter"
)

const defaultBaseURL = "https://wishkit.juli.sh"

func main() {
	if len(os.Args) < 2 {
		usage()
		os.Exit(2)
	}

	switch os.Args[1] {
	case "projects":
		cmdProjects(os.Args[2:])
	case "wishes":
		cmdWishes(os.Args[2:])
	case "bugs":
		cmdBugs(os.Args[2:])
	case "help", "-h", "--help":
		usage()
	default:
		fmt.Fprintf(os.Stderr, "unknown command %q\n\n", os.Args[1])
		usage()
		os.Exit(2)
	}
}

// ── shared flags / helpers ──────────────────────────────────────────────────

type commonFlags struct {
	url  string
	key  string
	json bool
}

func addCommon(fs *flag.FlagSet) *commonFlags {
	c := &commonFlags{}
	fs.StringVar(&c.url, "url", envOr("OPENWISH_API_URL", defaultBaseURL), "API base URL")
	fs.StringVar(&c.key, "key", os.Getenv("OPENWISH_API_KEY"), "global API key")
	fs.BoolVar(&c.json, "json", false, "print raw JSON instead of a table")
	return c
}

func (c *commonFlags) client() *Client {
	if c.key == "" {
		fatal("missing API key: set OPENWISH_API_KEY or pass --key")
	}
	return NewClient(c.url, c.key)
}

func envOr(name, fallback string) string {
	if v := os.Getenv(name); v != "" {
		return v
	}
	return fallback
}

func fatal(msg string) {
	fmt.Fprintln(os.Stderr, "error: "+msg)
	os.Exit(1)
}

// check aborts with the server's error message on transport failure or any
// non-2xx status.
func check(err error, status int, body []byte) {
	if err != nil {
		fatal(err.Error())
	}
	if status < 200 || status >= 300 {
		var e struct {
			Error  string `json:"error"`
			Reason string `json:"reason"`
		}
		_ = json.Unmarshal(body, &e)
		msg := e.Error
		if msg == "" {
			msg = e.Reason
		}
		if msg == "" {
			msg = string(body)
		}
		fatal(fmt.Sprintf("request failed (HTTP %d): %s", status, msg))
	}
}

func printJSON(body []byte) {
	var pretty any
	if err := json.Unmarshal(body, &pretty); err != nil {
		fmt.Println(string(body))
		return
	}
	out, _ := json.MarshalIndent(pretty, "", "  ")
	fmt.Println(string(out))
}

func mustUnmarshal(body []byte, v any) {
	if err := json.Unmarshal(body, v); err != nil {
		fatal("could not parse server response: " + err.Error())
	}
}

func newTabWriter() *tabwriter.Writer {
	return tabwriter.NewWriter(os.Stdout, 0, 2, 2, ' ', 0)
}

func usage() {
	fmt.Print(`openwish — CLI for the OpenWish global API

Usage:
  openwish projects list
  openwish projects create --slug <slug> --name <name> [--watermark]
  openwish wishes list --project <slug>
  openwish wishes create --project <slug> --title <t> --description <d> [--email <e>] [--state <s>]
  openwish bugs list --project <slug>
  openwish bugs create --project <slug> --title <t> --description <d> [--email <e>]

Global flags (valid on any subcommand):
  --url    API base URL          (env OPENWISH_API_URL, default https://wishkit.juli.sh)
  --key    global API key        (env OPENWISH_API_KEY)
  --json   print raw JSON instead of a table

Environment:
  OPENWISH_API_URL   base URL of your OpenWish worker
  OPENWISH_API_KEY   the global API key (server-side OPENWISH_GLOBAL_API_KEY)
`)
}

// ── projects ────────────────────────────────────────────────────────────────

func cmdProjects(args []string) {
	if len(args) < 1 {
		fatal("usage: openwish projects <list|create> [flags]")
	}
	switch args[0] {
	case "list":
		fs := flag.NewFlagSet("projects list", flag.ExitOnError)
		common := addCommon(fs)
		_ = fs.Parse(args[1:])

		body, status, err := common.client().Get("/api/v1/projects")
		check(err, status, body)
		if common.json {
			printJSON(body)
			return
		}
		var out struct {
			Projects []struct {
				Slug      string `json:"slug"`
				Name      string `json:"name"`
				CreatedAt string `json:"createdAt"`
			} `json:"projects"`
		}
		mustUnmarshal(body, &out)
		w := newTabWriter()
		fmt.Fprintln(w, "SLUG\tNAME\tCREATED")
		for _, p := range out.Projects {
			fmt.Fprintf(w, "%s\t%s\t%s\n", p.Slug, p.Name, p.CreatedAt)
		}
		_ = w.Flush()

	case "create":
		fs := flag.NewFlagSet("projects create", flag.ExitOnError)
		common := addCommon(fs)
		slug := fs.String("slug", "", "project slug (required)")
		name := fs.String("name", "", "project name (required)")
		watermark := fs.Bool("watermark", false, "enable watermark")
		_ = fs.Parse(args[1:])
		if *slug == "" || *name == "" {
			fatal("projects create requires --slug and --name")
		}
		body, status, err := common.client().Post("/api/v1/projects", map[string]any{
			"slug":             *slug,
			"name":             *name,
			"watermarkEnabled": *watermark,
		})
		check(err, status, body)
		printJSON(body)

	default:
		fatal("usage: openwish projects <list|create>")
	}
}

// ── wishes ──────────────────────────────────────────────────────────────────

func cmdWishes(args []string) {
	if len(args) < 1 {
		fatal("usage: openwish wishes <list|create> [flags]")
	}
	switch args[0] {
	case "list":
		fs := flag.NewFlagSet("wishes list", flag.ExitOnError)
		common := addCommon(fs)
		project := fs.String("project", "", "project slug (required)")
		_ = fs.Parse(args[1:])
		requireProject(*project)

		body, status, err := common.client().Get("/api/v1/projects/" + *project + "/wishes")
		check(err, status, body)
		if common.json {
			printJSON(body)
			return
		}
		var out struct {
			List []struct {
				Title       string `json:"title"`
				State       string `json:"state"`
				VotingUsers []any  `json:"votingUsers"`
				CommentList []any  `json:"commentList"`
			} `json:"list"`
		}
		mustUnmarshal(body, &out)
		w := newTabWriter()
		fmt.Fprintln(w, "VOTES\tSTATE\tTITLE\tCOMMENTS")
		for _, item := range out.List {
			fmt.Fprintf(w, "%d\t%s\t%s\t%d\n", len(item.VotingUsers), item.State, item.Title, len(item.CommentList))
		}
		_ = w.Flush()

	case "create":
		fs := flag.NewFlagSet("wishes create", flag.ExitOnError)
		common := addCommon(fs)
		project := fs.String("project", "", "project slug (required)")
		title := fs.String("title", "", "wish title (required)")
		description := fs.String("description", "", "wish description (required)")
		email := fs.String("email", "", "reporter email (optional)")
		state := fs.String("state", "", "initial state (optional, defaults to pending)")
		_ = fs.Parse(args[1:])
		requireProject(*project)
		if *title == "" || *description == "" {
			fatal("wishes create requires --title and --description")
		}
		payload := map[string]any{"title": *title, "description": *description}
		if *email != "" {
			payload["email"] = *email
		}
		if *state != "" {
			payload["state"] = *state
		}
		body, status, err := common.client().Post("/api/v1/projects/"+*project+"/wishes", payload)
		check(err, status, body)
		printJSON(body)

	default:
		fatal("usage: openwish wishes <list|create>")
	}
}

// ── bugs ────────────────────────────────────────────────────────────────────

func cmdBugs(args []string) {
	if len(args) < 1 {
		fatal("usage: openwish bugs <list|create> [flags]")
	}
	switch args[0] {
	case "list":
		fs := flag.NewFlagSet("bugs list", flag.ExitOnError)
		common := addCommon(fs)
		project := fs.String("project", "", "project slug (required)")
		_ = fs.Parse(args[1:])
		requireProject(*project)

		body, status, err := common.client().Get("/api/v1/projects/" + *project + "/bugs")
		check(err, status, body)
		if common.json {
			printJSON(body)
			return
		}
		var out struct {
			List []struct {
				Title       string `json:"title"`
				State       string `json:"state"`
				CreatedAt   string `json:"createdAt"`
				CommentList []any  `json:"commentList"`
			} `json:"list"`
		}
		mustUnmarshal(body, &out)
		w := newTabWriter()
		fmt.Fprintln(w, "STATE\tTITLE\tCOMMENTS\tCREATED")
		for _, item := range out.List {
			fmt.Fprintf(w, "%s\t%s\t%d\t%s\n", item.State, item.Title, len(item.CommentList), item.CreatedAt)
		}
		_ = w.Flush()

	case "create":
		fs := flag.NewFlagSet("bugs create", flag.ExitOnError)
		common := addCommon(fs)
		project := fs.String("project", "", "project slug (required)")
		title := fs.String("title", "", "bug title (required)")
		description := fs.String("description", "", "bug description (required)")
		email := fs.String("email", "", "reporter email (optional)")
		_ = fs.Parse(args[1:])
		requireProject(*project)
		if *title == "" || *description == "" {
			fatal("bugs create requires --title and --description")
		}
		payload := map[string]any{
			"title":          *title,
			"description":    *description,
			"screenshotKeys": []string{},
		}
		if *email != "" {
			payload["email"] = *email
		}
		body, status, err := common.client().Post("/api/v1/projects/"+*project+"/bugs", payload)
		check(err, status, body)
		printJSON(body)

	default:
		fatal("usage: openwish bugs <list|create>")
	}
}

func requireProject(slug string) {
	if slug == "" {
		fatal("missing --project <slug>")
	}
}
