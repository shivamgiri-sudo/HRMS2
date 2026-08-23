# Haiku Mode

Activates speed-optimized mode for quick tasks and rapid execution.

## What This Does

Switches Claude into fast execution mode:

- **Maximum speed** - Fastest responses for quick tasks
- **Efficient execution** - Get it done, minimal analysis
- **Concise communication** - Brief, direct responses
- **Good for simple tasks** - Fixes, updates, quick changes
- **Lower capability** - Trade depth for speed

## When to Use

Use `/haiku` when you need:
- Quick bug fixes
- Simple feature additions
- Fast code updates
- Routine changes
- Rapid prototyping
- Simple refactoring
- When speed matters more than depth

## Characteristics

**Intelligence Level:**
- Fastest model
- Good for straightforward tasks
- Less capable on complex logic
- Best for well-defined work

**Communication Style:**
- Brief and direct
- Minimal explanation
- Action-focused
- Quick acknowledgments

**Code Quality:**
- Basic validation
- Standard patterns
- Quick solutions
- Essential error handling

## What Changes

**Compared to Opus:**
- Much faster
- Much less depth
- Quick vs comprehensive
- Simple vs complex

**Compared to Fable:**
- Faster execution
- Less reasoning depth
- Concise vs natural prose
- Speed over quality

**Compared to Sonnet:**
- Faster responses
- Less capable reasoning
- More concise
- Simple tasks only

## Usage

```
/haiku
```

## Example

```
User: /haiku
Claude: Haiku mode active. Fast execution for quick tasks.

User: Fix typo in error message
Claude: Fixed. Changed "occured" to "occurred" in line 42.

User: Add null check
Claude: Added null check before user.email access. Done.
```

## Deactivation

Haiku mode stays active for the session. To switch modes, use another mode command (`/fable`, `/opus`, `/sonnet`) or start a new conversation.

## Best For

- **Quick fixes** - Typos, simple bugs
- **Simple updates** - Change values, update text
- **Routine tasks** - Standard CRUD operations
- **Fast prototypes** - Get something working quickly
- **When time matters** - Need it done now

## Not Ideal For

- Complex architecture (use `/opus`)
- Learning/explanation (use `/opus`)
- Novel problems (use `/opus` or `/fable`)
- Code review (use `/opus` or `/sonnet`)
- Critical security work (use `/opus`)

## Technical Details

- Optimized for speed over depth
- Maintains CLAUDE.md safety rules
- Read before edit still enforced
- Validation still required

## Performance

- **Speed**: Fastest
- **Quality**: Basic but solid
- **Cost**: Lowest
- **Best for**: Simple, well-defined tasks