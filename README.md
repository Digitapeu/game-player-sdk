# Digitap HTML5 SDK
This is the documentation of the "Digitap HTML5 SDK" project.

Running into any issues? Send us an email to <a href="support@digitap.eu" target="_blank">support@digitap.eu</a>

## Implementation within games
The SDK should be integrated within HTML5 games by loading it through our CDN. Implement the following snippet within your game or within the `<head>` section of your `index.html`.

```html
<!-- Digitap SDK Start -->
<script src="https://files.digitap.eu/sdk/main.min.js" type="text/javascript"></script>
<script>
    let showScore = true; // If you want to show score in our GameBox
    let showHighScore = true; // If you want to show high score in our GameBox

    // Init the SDK
    _digitapSDK.init(showScore, showHighScore);

    // Handle the events from our GameBox
    _digitapSDK._afterStartGameFromZero = function() {
        // start the game fresh, from zero
        console.log("After start game from zero");
    }

    _digitapSDK._afterContinueWithCurrentScore = function(score) {
        // user paid for extra live, continue game from last score
        console.log("Continue with current score: ", score);
    }

    _digitapSDK._afterStartGame = function() {
        // advertisement done, resume game logic and unmute audio
        console.log("After start game");
    }

    _digitapSDK._afterPauseGame = function() {
        // pause game logic / mute audio
        console.log("After pause game");
    }
</script>
<!-- Digitap SDK End -->
```

*Make sure that the SDK is loaded before your game starts or while your game is loaded for the best user experience. Not after, and especially not by clicking a button within the game, as then it will take too long for an advertisement to load; making the user wait. **Only load the SDK once!***

### Mandatory settings for setup
After you init the SDK with the following lines of code:

```javascript
let showScore = true; // If you want to show score in our GameBox
let showHighScore = true; // If you want to show high score in our GameBox

// Init the SDK
_digitapSDK.init(showScore, showHighScore);
```

You need to make sure that our events are handled well by your game. For this, you need to declare some callbacks that will be used when events trigger from the GameBox. These are:

```javascript
_digitapSDK._afterStartGameFromZero = function() {
    // start the game fresh, from zero
    console.log("After start game from zero");
}
```

`_afterStartGameFromZero` will be called the first time when the game starts but also if we want to reset the game for that session. You should reset the score and level (if its the case) and start the game.

```javascript
_digitapSDK._afterContinueWithCurrentScore = function(score) {
    // user paid for extra live, continue game from last score
    console.log("Continue with current score: ", score);
}
```

`_afterContinueWithCurrentScore` will be called after the user failed but he paid to continue the game from the last score. You will receive as a parameter the last score we recorded.

```javascript
_digitapSDK._afterPauseGame = function() {
    // pause game logic / mute audio
    console.log("After pause game");
}
```

`_afterPauseGame` will be called when we want to pause the game to run an advertisement. Invoke a method to pause AND mute your game. It is important that the game is muted, as background audio through video advertisements is forbidden.

```javascript
_digitapSDK._afterStartGame = function() {
    // advertisement done, resume game logic and unmute audio
    console.log("After start game");
}
```

`_afterStartGame` will be called when we want to resume the game after it was paused. Invoke a method to resume your game.