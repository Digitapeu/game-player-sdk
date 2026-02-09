# Digitap SDK Integration Guide

## Quick Start

### 1. Include the SDK - if not already included

Add the script to your game's HTML before your game code:

```html
<script src="https://cdn.wam.app/sdk/main.min.js"></script>
```

### 2. Initialize

```javascript
digitapSDK('init', true, true);
```

Parameters:
- `hasScore` (boolean) - Show score UI
- `hasHighScore` (boolean) - Show high score UI

### 3. Register Callbacks

```javascript
digitapSDK('setCallback', 'afterStartGame', function() {
    // Start your game
    game.start();
});

digitapSDK('setCallback', 'afterStartGameFromZero', function() {
    // Reset and start from zero
    game.reset();
    game.start();
});

digitapSDK('setCallback', 'afterContinueWithCurrentScore', function() {
    // Continue after death (revive)
    game.resume();
});

digitapSDK('setCallback', 'afterPauseGame', function() {
    // Pause the game
    game.pause();
});
```

### 4. Report Score

Call this whenever the score changes:

```javascript
digitapSDK('setProgress', 'PLAYING', score, level);
```

Parameters:
- `state` (string) - Game state: `'PLAYING'`, `'PAUSED'`, etc.
- `score` (number) - Current score
- `level` (number) - Current level

### 5. Report Level Up

```javascript
digitapSDK('setLevelUp', newLevel);
```

### 6. Report Player Death

```javascript
digitapSDK('setPlayerFailed', 'GAME_OVER');
```

---

## Complete Example

```html
<!DOCTYPE html>
<html>
<head>
    <title>My Game</title>
</head>
<body>
    <canvas id="game"></canvas>
    
    <!-- SDK must be loaded BEFORE your game code -->
    <script src="https://cdn.wam.app/sdk/main.min.js"></script>
    
    <script>
        // Your game object
        const game = {
            score: 0,
            level: 1,
            
            start() {
                this.score = 0;
                this.level = 1;
                this.running = true;
                this.loop();
            },
            
            reset() {
                this.score = 0;
                this.level = 1;
            },
            
            resume() {
                this.running = true;
                this.loop();
            },
            
            pause() {
                this.running = false;
            },
            
            addScore(points) {
                this.score += points;
                // Report score to platform
                digitapSDK('setProgress', 'PLAYING', this.score, this.level);
            },
            
            levelUp() {
                this.level++;
                digitapSDK('setLevelUp', this.level);
            },
            
            gameOver() {
                this.running = false;
                digitapSDK('setPlayerFailed', 'GAME_OVER');
            },
            
            loop() {
                if (!this.running) return;
                // Game logic here
                requestAnimationFrame(() => this.loop());
            }
        };
        
        // Initialize SDK
        digitapSDK('init', true, true);
        
        // Register callbacks
        digitapSDK('setCallback', 'afterStartGame', () => game.start());
        digitapSDK('setCallback', 'afterStartGameFromZero', () => {
            game.reset();
            game.start();
        });
        digitapSDK('setCallback', 'afterContinueWithCurrentScore', () => game.resume());
        digitapSDK('setCallback', 'afterPauseGame', () => game.pause());
    </script>
</body>
</html>
```

---

## Legacy API (v1.0.0)

If your game uses the old `_digitapUser` API, it still works:

```javascript
// Initialize
_digitapUser.init(['sound', 'background']);

// Register callbacks (override methods)
_digitapUser._afterStartGame = function() {
    game.start();
};

_digitapUser._afterStartGameFromZero = function() {
    game.reset();
    game.start();
};

_digitapUser._afterContinueWithCurrentScore = function() {
    game.resume();
};

// Report score
_digitapUser.progress.score = 100;
_digitapUser.progress.state = 'PLAYING';
_digitapUser.sendData();
```

---

## API Reference

### Methods

| Method | Description |
|--------|-------------|
| `digitapSDK('init', hasScore, hasHighScore)` | Initialize SDK |
| `digitapSDK('setCallback', name, fn)` | Register callback |
| `digitapSDK('setProgress', state, score, level)` | Report score |
| `digitapSDK('setLevelUp', level)` | Report level up |
| `digitapSDK('setPlayerFailed', state)` | Report death |

### Callbacks

| Callback Name | When It's Called |
|---------------|------------------|
| `afterStartGame` | User starts the game |
| `afterStartGameFromZero` | User restarts from zero |
| `afterContinueWithCurrentScore` | User continues after death (revive) |
| `afterPauseGame` | Game is paused |

### States

Common state values:
- `'PLAYING'` - Game is active
- `'PAUSED'` - Game is paused
- `'GAME_OVER'` - Player died
- `'FAIL'` - Player failed

### Connection Status

Check if SDK is connected to GameBox:

```javascript
if (DigitapGamePlayerSDK.isConnected) {
    console.log('Connected to GameBox');
}
```

The SDK automatically retries connection for 5 seconds on load. Games work even without a connection, but security features require an active session.

---

## Checklist

- [ ] SDK script loaded before game code
- [ ] `digitapSDK('init', ...)` called on page load
- [ ] All 4 callbacks registered
- [ ] `setProgress` called on every score change
- [ ] `setPlayerFailed` called on game over
- [ ] Game doesn't auto-start (waits for `afterStartGame`)

---

## Troubleshooting

**Game doesn't start**
- Make sure you registered `afterStartGame` callback
- Don't auto-start your game; wait for the callback

**Score not updating**
- Call `setProgress` every time score changes
- Check browser console for errors

**Callbacks not firing**
- Verify SDK is loaded before your game code
- Check that `init()` was called

**"GameBox connection timeout" warning**
- This is non-fatal - the SDK continues working
- Means GameBox didn't respond to SDK_LOADED within 5 seconds
- Check that the game is running inside GameBox iframe
- Verify GameBox is configured to handle SDK messages

**Testing locally**
- Use `localhost:3000`, `localhost:8080`, or `localhost:63342`
- Other ports may be blocked by origin validation

---

## Connection Flow

```
Page Load
    │
    ├─► SDK sends SDK_LOADED (retries every 500ms, max 10x)
    │
    ├─► GameBox sends SDK_SESSION_INIT
    │       └─► SDK connected ✓
    │
    └─► Game calls digitapSDK('init', ...)
            └─► Ready for gameplay
```

The SDK automatically handles connection retries. No action needed from game developers.
