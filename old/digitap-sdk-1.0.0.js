_digitapUser = {
    gameObject: null,
    isLoaded: false,
    origin: null,
    allowedOrigins: [
        'https://build.digitap.dev', 
        'https://wam.app', 
        'https://app.wam.app', 
        'https://wam.eu', 
        'http://localhost:63342', 
        'http://localhost:8080', 
        'http://localhost:3000'
    ],
    progress: {
        controller: '_digitapGame', 
        type: 'progress', 
        score: 0, 
        state: null, 
        continueScore: 0 
    },
    extra: {
        multiplier: 1 
    },
    sendData: function (gameObject) {
        if (typeof (gameObject) !== 'undefined') {
            this.gameObject = gameObject;
        }
        this.progress.continueScore = this.progress.score;
        window.parent.postMessage(this.progress, this.origin);
    },
    init: function (uiOptions) { // settings: ['sound', 'background'],
        var self = this;
        if (!this.isLoaded) {
            // make the first request to parent ... with the settings UI
            window.parent.postMessage({
                controller: '_digitapGame',
                type: 'settings',
                ui: uiOptions,
                ready: true
            }, '*');

            // start listening for the messages from the platform
            window.addEventListener("message", function (event) {
                if (typeof (event.data) == 'object' && event.data.controller && event.data.controller == '_digitapApp') {
                    let originIndex = self.allowedOrigins.indexOf(event.origin);
                    if (originIndex === -1) {
                        console.error('Error: Origin not allowed inside game container!');
                        return;
                    } else {
                        self.origin = self.allowedOrigins[originIndex];
                    }

                    if (event.data.type) {
                        if (event.data.type === 'startGame') {
                            self._afterStartGame();

                        } else if (event.data.type == 'startGameFromZero') {
                            _digitapUser.progress.score = 0;
                            _digitapUser.progress.continueScore = 0;

                            self._afterStartGameFromZero();

                        } else if (event.data.type === 'continueWithCurrentScore') {
                            // continue with current score...
                            _digitapUser.progress.score = _digitapUser.progress.continueScore;

                            self._afterContinueWithCurrentScore();
                        } else {
                            console.error('Error: `data.type` = "' + event.data.type + '" not found! Please check `readme.md` of data collector package!');
                        }
                    } else {
                        console.error('Error: `event.data.type` should be implemented!');
                    }
                }
            }, false);
            //////
        }
        this.isLoaded = true;
    },
    _afterStartGameFromZero: function () {
        // rewrite this method in order to add more logic inside each game
    },
    _afterContinueWithCurrentScore: function () {
        // rewrite this method in order to add more logic inside each game
    },
    _afterStartGame: function () {
        // rewrite this method in order to add more logic inside each game
    }
};