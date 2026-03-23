const CLI_NAME = "solidx";

/** BYO enrichment / --follow-up styles (bash completion after --style / --follow-up). */
const ENRICH_STYLES = "briefing rca executive runbook star car debug questions";

const REPORT_STYLES = "rca star car executive debug timeline";
const REPORT_STATES = "final snapshot live partial";

const COMMANDS = ["analyze", "enrich", "report", "session", "export", "config", "completion", "help"];
const SESSION_SUBCOMMANDS = ["list", "show", "delete"];
const CONFIG_SUBCOMMANDS = ["show", "set"];
const COMPLETION_SUBCOMMANDS = ["bash", "zsh", "fish", "powershell"];

const FLAGS = [
  "-V",
  "--version",
  "-h",
  "--help",
  "--no-tui",
  "--json",
  "--text",
  "--md",
  "--html",
  "--inspect",
  "--interval",
  "--hide-header",
  "--skip-splash",
  "--log-level",
  "--save",
  "--session-name",
  "--verbose",
  "--no-ai",
  "--finalize",
  "--web",
  "--port",
  "--no-open",
  "--output",
  "--provider",
  "--url",
  "--api-key",
  "--model",
  "--style",
  "--timeout",
  "--enrich-timeout",
  "--header",
  "--system-prompt-file",
  "--prompt-file",
  "--temperature",
  "--max-tokens",
  "--follow-up",
  "--heuristic-rca",
  "--heuristic-interview",
  "--state",
  "--no-polish",
  "--no-confidence",
  "--no-trust-notes",
  "--no-suggested-fixes",
];

function bashScript(): string {
  return `# ${CLI_NAME} bash completion
_${CLI_NAME}() {
  local cur prev words cword
  _init_completion -s || return
  case "$prev" in
    --log-level)
      COMPREPLY=($(compgen -W "error warn info debug" -- "$cur"))
      return
      ;;
    session)
      COMPREPLY=($(compgen -W "${SESSION_SUBCOMMANDS.join(" ")}" -- "$cur"))
      return
      ;;
    config)
      COMPREPLY=($(compgen -W "${CONFIG_SUBCOMMANDS.join(" ")}" -- "$cur"))
      return
      ;;
    completion)
      COMPREPLY=($(compgen -W "${COMPLETION_SUBCOMMANDS.join(" ")}" -- "$cur"))
      return
      ;;
    -s)
      if [[ "\${words[1]}" == "report" ]]; then
        COMPREPLY=($(compgen -W "${REPORT_STYLES}" -- "$cur"))
      fi
      return
      ;;
    --state)
      COMPREPLY=($(compgen -W "${REPORT_STATES}" -- "$cur"))
      return
      ;;
    --style|--follow-up)
      if [[ "\${words[1]}" == "report" ]]; then
        COMPREPLY=($(compgen -W "${REPORT_STYLES}" -- "$cur"))
      else
        COMPREPLY=($(compgen -W "${ENRICH_STYLES}" -- "$cur"))
      fi
      return
      ;;
    --detail)
      COMPREPLY=($(compgen -W "short standard detailed" -- "$cur"))
      return
      ;;
    show|delete)
      if [[ "$prev" == "show" || "$prev" == "delete" ]]; then
        local sessions
        sessions=$(${CLI_NAME} session list 2>/dev/null | awk '{print $1}')
        COMPREPLY=($(compgen -W "$sessions" -- "$cur"))
      fi
      return
      ;;
    export)
      local sessions
      sessions=$(${CLI_NAME} session list 2>/dev/null | awk '{print $1}')
      COMPREPLY=($(compgen -W "$sessions" -- "$cur"))
      return
      ;;
    report)
      COMPREPLY=($(compgen -f -- "$cur"))
      return
      ;;
  esac
  if [[ "$cur" == -* ]]; then
    COMPREPLY=($(compgen -W "${FLAGS.join(" ")}" -- "$cur"))
  else
    COMPREPLY=($(compgen -W "${COMMANDS.join(" ")}" -- "$cur"))
  fi
}
complete -F _${CLI_NAME} ${CLI_NAME}
`;
}

function zshScript(): string {
  return `# ${CLI_NAME} zsh completion
#compdef _${CLI_NAME} ${CLI_NAME}

_${CLI_NAME}() {
  local curcontext="\$curcontext" state line
  typeset -A opt_args

  _arguments -C \\
    '1:command:(${COMMANDS.join(" ")})' \\
    '*::arg:->args'

  case "\$state" in
    args)
      case "\$line[1]" in
        session)
          _values 'session subcommand' ${SESSION_SUBCOMMANDS.join(" ")}
          ;;
        config)
          _values 'config subcommand' ${CONFIG_SUBCOMMANDS.join(" ")}
          ;;
        completion)
          _values 'completion shell' ${COMPLETION_SUBCOMMANDS.join(" ")}
          ;;
        *)
          _arguments \\
            '(-V --version)'{-V,--version}'[output version]' \\
            '(-h --help)'{-h,--help}'[display help]' \\
            '--no-tui[disable TUI]' \\
            '--json[output JSON]' \\
            '--text[output plain text]' \\
            '--md[output markdown]' \\
            '--html[output HTML]' \\
            '--inspect[inspect/read-only mode]' \\
            '--interval[poll interval]:seconds' \\
            '--hide-header[hide header strip]' \\
            '--skip-splash[skip splash banner]' \\
            '--log-level[log level]:level:(error warn info debug)' \\
            '--save[save session]' \\
            '--session-name[name]:name' \\
            '--verbose[verbose output]' \\
            '--no-ai[disable AI]' \\
            '--heuristic-rca[attach engine RCA snapshot]' \\
            '--heuristic-interview[attach engine STAR snapshot]' \\
            '--output[output file]:file:_files'
          ;;
      esac
      ;;
  esac
}
`;
}

function fishScript(): string {
  return `# ${CLI_NAME} fish completion
complete -c ${CLI_NAME} -f

complete -c ${CLI_NAME} -n "__fish_use_subcommand" -a "analyze" -d "Analyze logs from files/stdin"
complete -c ${CLI_NAME} -n "__fish_use_subcommand" -a "enrich" -d "Optional AI enrichment from analysis JSON"
complete -c ${CLI_NAME} -n "__fish_use_subcommand" -a "report" -d "Deterministic report from analysis JSON"
complete -c ${CLI_NAME} -n "__fish_use_subcommand" -a "session" -d "Manage saved sessions"
complete -c ${CLI_NAME} -n "__fish_use_subcommand" -a "export" -d "Export an existing session"
complete -c ${CLI_NAME} -n "__fish_use_subcommand" -a "config" -d "View or update config"
complete -c ${CLI_NAME} -n "__fish_use_subcommand" -a "completion" -d "Generate shell completion"
complete -c ${CLI_NAME} -n "__fish_use_subcommand" -a "help" -d "Display help"

complete -c ${CLI_NAME} -s V -l version -d "Display version"
complete -c ${CLI_NAME} -s h -l help -d "Display help"
complete -c ${CLI_NAME} -l no-tui -d "Disable TUI"
complete -c ${CLI_NAME} -l json -d "Output JSON"
complete -c ${CLI_NAME} -l text -d "Output plain text"
complete -c ${CLI_NAME} -l md -d "Output markdown"
complete -c ${CLI_NAME} -l html -d "Output HTML"
complete -c ${CLI_NAME} -l inspect -d "Inspect (read-only) mode"
complete -c ${CLI_NAME} -l interval -d "Poll interval (sec)" -x
complete -c ${CLI_NAME} -l hide-header -d "Hide header strip"
complete -c ${CLI_NAME} -l skip-splash -d "Skip splash banner"
complete -c ${CLI_NAME} -l log-level -d "Log level" -a "error warn info debug"
complete -c ${CLI_NAME} -l save -d "Save session"
complete -c ${CLI_NAME} -l session-name -d "Session name" -x
complete -c ${CLI_NAME} -l verbose -d "Verbose output"
complete -c ${CLI_NAME} -l no-ai -d "Disable BYO LLM"
complete -c ${CLI_NAME} -l heuristic-rca -d "Engine RCA snapshot"
complete -c ${CLI_NAME} -l heuristic-interview -d "Engine STAR snapshot"
complete -c ${CLI_NAME} -l output -d "Output file" -r
complete -c ${CLI_NAME} -n "__fish_seen_subcommand_from_root report" -s s -l style -d "Report style" -x -a "${REPORT_STYLES}"
complete -c ${CLI_NAME} -n "__fish_seen_subcommand_from_root report" -l state -d "Report state" -x -a "${REPORT_STATES}"
complete -c ${CLI_NAME} -n "__fish_seen_subcommand_from_root report" -l no-polish -d "Skip cleanup pass"
complete -c ${CLI_NAME} -n "__fish_seen_subcommand_from_root report" -l no-confidence -d "Omit confidence"
complete -c ${CLI_NAME} -n "__fish_seen_subcommand_from_root report" -l no-trust-notes -d "Omit trust notes"
complete -c ${CLI_NAME} -n "__fish_seen_subcommand_from_root report" -l no-suggested-fixes -d "Omit suggested fixes"
`;
}

function powershellScript(): string {
  const cmds = COMMANDS.map((c) => `'${c}'`).join(",");
  const flgs = FLAGS.map((f) => `'${f}'`).join(",");
  return `# ${CLI_NAME} PowerShell completion
# Save and run: . .\\${CLI_NAME}-completion.ps1

$commands = @(${cmds})
$flags = @(${flgs})
$all = $commands + $flags

Register-ArgumentCompleter -CommandName ${CLI_NAME} -ScriptBlock {
  param($wordToComplete, $commandAst, $cursorPosition)
  $all | Where-Object { $_ -like "$wordToComplete*" }
}
`;
}

export function getCompletionScript(shell: "bash" | "zsh" | "fish" | "powershell"): string {
  switch (shell) {
    case "bash":
      return bashScript();
    case "zsh":
      return zshScript();
    case "fish":
      return fishScript();
    case "powershell":
      return powershellScript();
    default:
      throw new Error(`Unsupported shell: ${shell}`);
  }
}
