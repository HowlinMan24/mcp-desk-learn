# Run with: source tools/env.sh node   (or: go)
# Points your code at the local database and the fake services.
track="${1:-node}"
case "$track" in
  node | go) ;;
  *) echo "Usage: source tools/env.sh node|go"; return 1 ;;
esac
export DATABASE_URL="postgresql://desk:desk@127.0.0.1:5544/desk_$track"
export ANTHROPIC_BASE_URL="http://127.0.0.1:47101"
export ANTHROPIC_API_KEY="fake-key"
export REDPROOF_API="http://127.0.0.1:47102/api/v1"
export MCP_CONFIG="$PWD/$track/mcp.json"
echo "Environment set for the $track track (fake Claude, local Postgres)."
