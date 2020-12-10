# Digitap HTML5 SDK
This is the documentation of the "Digitap HTML5 SDK" project.

Running into any issues? Send us an email to <a href="support@digitap.eu" target="_blank">support@digitap.eu</a>

## Implementation within games
The SDK should be integrated within HTML5 games by loading it through our CDN. Implement the following snippet within your game or within the `<head>` section of your `index.html`.

```html
<!-- Digitap SDK Start -->
<script>
    window.digitapSDK=window.digitapSDK||function(){(digitapSDK.q=digitapSDK.q||[]).push(arguments)};digitapSDK.l=+new Date;

    // === SETUP EXAMPLE === //
    // Edit only from here downwards
    
    let showScore = true; // If you want to show score in our GameBox
    let showHighScore = true; // If you want to show high score in our GameBox

    // Init the SDK
    digitapSDK('init', showScore, showHighScore);

    // Handle the events from our GameBox
    digitapSDK('setCallback', 'afterStartGameFromZero', function() {
        // start the game fresh, from zero
        console.log("After start game from zero");
    });

    digitapSDK('setCallback', 'afterContinueWithCurrentScore', function(score) {
        // user paid for extra live, continue game from last score
        console.log("Continue with current score: ", score);
    });

    digitapSDK('setCallback', 'afterStartGame', function() {
        // advertisement done, resume game logic and unmute audio
        console.log("After start game");
    });

    digitapSDK('setCallback', 'afterPauseGame', function() {
        // pause game logic / mute audio
        console.log("After pause game");
    });
</script>
<script src="https://files.digitap.eu/sdk/main.min.js" async defer></script>
<!-- Digitap SDK End -->
```

*Make sure that the SDK is loaded before your game starts or while your game is loaded for the best user experience. Not after, and especially not by clicking a button within the game, as then it will take too long for an advertisement to load; making the user wait. **Only load the SDK once!***


### Mandatory settings for setup
After you init the SDK with the following lines of code:

```javascript
let showScore = true; // If you want to show score in our GameBox
let showHighScore = true; // If you want to show high score in our GameBox

// Init the SDK
digitapSDK('init', showScore, showHighScore);
```

You need to make sure that our events are handled well by your game. For this, you need to declare some callbacks that will be used when events trigger from the GameBox. These are:

```javascript
digitapSDK('setCallback', 'afterStartGameFromZero', function() {
    // start the game fresh, from zero
});
```

`afterStartGameFromZero` will be called the first time when the game starts but also if we want to reset the game for that session. You should reset the score and level (if its the case) and start the game.

```javascript
digitapSDK('setCallback', 'afterContinueWithCurrentScore', function(score) {
    // user paid for extra live, continue game from last score
});
```

`afterContinueWithCurrentScore` will be called after the user failed but he paid to continue the game from the last score. You will receive as a parameter the last score we recorded.

```javascript
digitapSDK('setCallback', 'afterPauseGame', function() {
    // pause game logic / mute audio
});
```

`afterPauseGame` will be called when we want to pause the game to run an advertisement. Invoke a method to pause AND mute your game. It is important that the game is muted, as background audio through video advertisements is forbidden.

```javascript
digitapSDK('setCallback', 'afterStartGame', function() {
    // advertisement done, resume game logic and unmute audio
});
```

`afterStartGame` will be called when we want to resume the game after it was paused. Invoke a method to resume your game.


### Integrate game events with the SDK
Now that the basic setup is done, you will need to integrate your main game events with our SDK. We have some methods that you can use for this: 


```javascript
let state = 'SOME_RANDOM_GAME_STATE';
let score = 10;
let level = 1; // If you don't have levels, leave it as 1

digitapSDK('setProgress', state, score, level);
```

`setProgress` method can be used to sync player's progress in the game with our GameBox. We suggest you to use this at every score change. The `state` parameter can be a string indicator of which was the last progress for this player. The `score` is the increased score. The `level` parameter it's the actual level, or 1 if your game don't have levels.


```javascript
let level = 2;

digitapSDK('setLevelUp', level);
```

`setLevelUp` method can be used when the player gets to the next level, to trigger a "level up" event in the GameBox. The `level` parameter indicates the new level the user got to.


```javascript
let state = 'FAILED';

digitapSDK('setPlayerFailed', state);
```

`setPlayerFailed` method can be used when the player had failed, so we can record the last score in the leaderboards. The `state` parameter is optional here, but it's recommended if you can add it.