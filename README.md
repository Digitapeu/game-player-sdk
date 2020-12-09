# Digitap HTML5 SDK
This is the documentation of the "Digitap HTML5 SDK" project.

Running into any issues? Send us an email to <a href="support@digitap.eu" target="_blank">support@digitap.eu</a>

## Implementation within games
The SDK should be integrated within HTML5 games by loading it through our CDN. Implement the following snippet within your game or within the `<head>` section of your `index.html`.

```
<!-- Digitap SDK Start -->
<script src="./main.min.js" type="text/javascript"></script>
<script>
    let showScore = true; // If you want to show score in our GameBox
    let showHighScore = true; // If you want to show high score in our GameBox

    _digitapSDK.init(showScore, showHighScore);

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