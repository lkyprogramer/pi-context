// Tests must not inherit the developer's Pi agent-dir override: most fixtures
// point HOME at a temp dir and expect <HOME>/.pi/agent to be the agent dir.
// Tests that exercise PI_CODING_AGENT_DIR set it explicitly and restore it.
delete process.env.PI_CODING_AGENT_DIR;
