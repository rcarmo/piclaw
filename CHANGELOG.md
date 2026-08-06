# Changelog

All notable changes to PiClaw are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Added

- **omp RPC engine pilot**: new agent engine backend selectable via `PICLAW_AGENT_ENGINE=omp-rpc` (default `pi`, unchanged). When enabled, `AgentPool.runAgent()` spawns a managed `omp --mode rpc` subprocess per chat and bridges its ndjson RPC protocol into piclaw's existing event/SSE pipeline. piclaw's built-in tools are exposed to omp via the host-tools sub-protocol. See [omp RPC pilot](docs/omp-rpc-pilot.md) for architecture, prerequisites, and limitations.
