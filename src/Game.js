const fs = require('fs');
const range = require('./utils').range;
const Player = require('./Player').Player;
const Voie = require('./Voie').Voie;

function get_json_data(path, key_id){
    let file = fs.readFileSync(path);
    let data = JSON.parse(file);
    let dict_data = {};
    for (point of data){
        dict_data[point[key_id]] = point;
    }
    return dict_data;
}

prodige_data = get_json_data('./data/prodigies.json', 'name');
voie_data = get_json_data('./data/voies.json', 'element');


module.exports.Game = class {
    constructor(room) {
        this.turn = 0;
        this.winner = null;
        this.state = {};
        this.scores = {};
        this.voies_players = null;

        // Création des voies
        this.voies = {};
        this.voies_sup = {};
        for(let element in voie_data) {
            if (['terre', 'eau', 'feu', 'air'].includes(element)) {
                this.voies[element] = new Voie(voie_data[element]);
            } else {
                this.voies_sup[element] = new Voie(voie_data[element]);
            }
        }

        // Création des joueurs
        let id0 = room[0].pseudo;
        let id1 = room[1].pseudo;
        let room_name = id0 + ' VS ' + id1;
        this.room = room_name;
        for (let socket of room) {
            socket.join(room_name);
        }

        var player0 = new Player(room[0], 0);
        player0.opp = id1;
        players[id0] = player0;

        var player1 = new Player(room[1], 1);
        player1.opp = id0;
        players[id1] = player1;

        // Création des prodiges
        player1.create_prodiges(["Amalrik", "Faine", "Foudre", "Svenn"]);
        player0.create_prodiges(["Alissonne", "Fizz", "Batsu", "Asato"]);

        // Assignation des joueurs à la partie
        this.players = [player0, player1]
    }

    get_player_by_order(order){
        for (let player of this.players){
            if (player.order === order) {
                return player;
            }
        }
    }

    apply_talents(){
        let t, order, player, p;

        if (this.state.label === 'talents:priority') {
            order = this.state.order;
            player = this.get_player_by_order(order);
            t = player.get_played_prodigy().talent;
            if (t.priority) {
                let state = t.execute_capacity(this.turn);
                this.update_front(state);
                if (state.status !== 'done') {
                    this.substate = state;
                } else if (this.state.order === 0) {
                    this.state.order++;
                    this.apply_talents();
                } else {
                    this.state.label = 'talents:normal';
                    this.state.order = 0;
                    this.apply_talents();
                }
            } else if (this.state.order === 0) {
                this.state.order++;
                this.apply_talents();
            } else {
                this.state.label = 'talents:normal';
                this.state.order = 0;
                this.apply_talents();
            }
        } else if (this.state.label === 'talents:normal') {
            order = this.state.order;
            player = this.get_player_by_order(this.state.order);
            t = player.get_played_prodigy().talent;
            if (!t.priority && !t.need_winner) {
                let state = t.execute_capacity(this.turn);
                this.update_front(state);
                if (state.status !== 'done') {
                    this.substate = state;
                    player.socket.emit('capacity_ongoing', state.label);
                } else if (this.state.order === 0) {
                    this.state.order++;
                    this.apply_talents();
                } else {
                    game.state.label = 'choice_glyphes';
                    io.to(player.socket.room).emit('text_log', 'Choix des Glyphes');
                }
            } else if (this.state.order === 0) {
                this.state.order++;
                this.apply_talents();
            } else {
                game.state.label = 'choice_glyphes';
                io.to(player.socket.room).emit('text_log', 'Choix des Glyphes');
            }
        } else if (this.state.label === 'talents:post_winner') {
            player = this.get_player_by_order(this.state.order);
            p = player.get_played_prodigy();
            if (p.talent.need_winner){
                let state = p.talent.execute_capacity(this.turn);
                this.update_front(state);
                if (state.status !== 'done') {
                    this.substate = state;
                    player.socket.emit('capacity_ongoing', state.label);
                } else if (this.state.order === 0) {
                    this.state.order++;
                    this.apply_talents();
                } else {
                    this.state.label = 'apply_voies';
                    this.substate = {};            
                    this.get_voies_players();
                    io.to(player.socket.room).emit('text_log', 'Application des Voies');
                }
            } else if (this.state.order === 0) {
                this.state.order++;
                this.apply_talents();
            } else {
                this.state.label = 'apply_voies';
                this.state.order = 0;
                io.to(player.socket.room).emit('text_log', 'Application des Voies');
                this.get_voies_players();
            }
        }
    }

    resolve_round(){
        // Score sur les voies
        let scores = {};
        let p1 = this.get_player_by_order(0);
        let g1 = p1.played_glyphs;
        let p2 = this.get_player_by_order(1);
        let g2 = p2.played_glyphs;
        console.log('Résolution du round');

        // Les joueurs perdent le regard
        p1.has_regard = false;
        p2.has_regard = false;

        for (let element in g1) {
            let winner = 0;
            if (p1.played_glyphs[element] > p2.played_glyphs[element]) {winner = -1}
            else if (p1.played_glyphs[element] < p2.played_glyphs[element]) {winner = 1}
            else {
                if (p1.get_played_prodigy().initiative){winner = -1}
                else if (p2.get_played_prodigy().initiative) {winner = -1}
            }
            scores[element] = winner;
        }
        this.scores = scores;

        // Détermination du gagnant
        let winner = this.get_winner(scores, p1, p2);

        // Attribution du statut de victoire
        let players = [p1, p2];
        players[winner % 2].winner = true;
        players[(winner + 1) % 2].winner = (winner !== 2) ? false : true;

        // Application des Talents éventuels
        this.state.label = 'talents:post_winner';
        this.state.order = 0;
        this.apply_talents();
    }

    get_voies_players(){
        console.log('Application des Voies');
        let element_ok, not_stopped, effect, p, v;
        let p1_win, p2_win, i, j, scores, effects, check_condition;

        scores = this.scores;
        effects = [[],[]];
        let translated = [{
            'air': 'none',
            'terre': 'none',
            'feu': 'none',
            'eau': 'none',
        }, {
            'air': 'none',
            'terre': 'none',
            'feu': 'none',
            'eau': 'none',
        }];
        for (let i = 0; i < 2; i++) {
            p = this.get_player_by_order(i);
            // On étudie toutes les voies
            for (j in this.voies) {
                v = this.voies[j];
                p1_win = (scores[v.element] === -1 && i === 0);
                p2_win = (scores[v.element] === 1 && i === 1);
                if ( p1_win || p2_win ) {
                    console.log(p.get_played_prodigy().name + "_" + p.order + " remporte " + v.element);
                    // S'il peut activer sa maîtrise
                    element_ok = (v.element === p.get_played_prodigy().element);
                    not_stopped = !p.get_played_prodigy().maitrise.stopped;
                    check_condition = p.get_played_prodigy().maitrise.check_condition();
                    effect = {'element': j, 'playable': true, 'display': true};
                    effect.maitrise = (element_ok && not_stopped && check_condition);
                    effects[i].push(effect);
                    translated[i][effect.element] = 'me';
                    translated[(i+1)%2][effect.element] = 'opp';
                }
            }
        }
        this.voies_players = effects;
        this.state.label = 'init_choice_voie';
        this.substate = {'label': 'none'};
        for (let i = 0; i < 2; i++) {
            this.get_player_by_order(i).socket.emit('update_voies', translated[i]);
        }
        this.apply_voies_players()
    }

    apply_voies_players(){
        let label = this.state.label;
        let order = this.state.order;
        let element = this.state.element;
        let player = this.get_player_by_order(order);
        let opp = this.get_player_by_order
        let c, p;
        if(label === 'init_choice_voie'){
            let effects = this.voies_players[order];
            let still = false;
            for (let effect of this.voies_players[order]) {
                if (effect.playable) {
                    still = true;
                    break;
                } 
            }
            if (!still) {
                if(order === 0) {
                    player.socket.emit('text_log', 'Aucun effet à appliquer');
                    this.state.order++;
                    this.apply_voies_players();
                } else if (order === 1) {
                    player.socket.emit('text_log', 'Aucun effet à appliquer');
                    this.state.label = 'end_round';
                    this.end_round();
                }
            } else {
                this.state.label = 'choice_voie';
                player.socket.emit('choices_voies', effects);
            }
        } else if (label === 'execute_voie') {
            for (let effect of this.voies_players[order]) {
                if (effect.element === element) {
                    if (this.state.maitrise) {
                        p = player.get_played_prodigy();
                        c = p.maitrise;
                        this.broadcast('Application Maîtrise ' + p.name);
                    } else {
                        c = this.voies[element].capacity;
                        c.owner = this.get_player_by_order(order);
                        this.broadcast('Application voie ' + element);
                    }
                    effect.display = false;
                    player.socket.emit('choices_voies', this.voies_players[order]);
                    let state = c.execute_capacity();
                    this.update_front(state);
                    if (state.status !== 'done') {
                        this.substate = state;
                        if (state.cost_type) {
                            state.capacity.owner.socket.emit('Coût à payer');
                        } else {
                            this.broadcast(state.capacity.target.pseudo + ' doit faire un choix');
                        }
                    } else {
                        // TODO mettre à jour l'état de la partie pour les deux joueurs
                        effect.playable = false;
                        this.state.label = 'init_choice_voie';
                        this.substate = {'label': 'none'};
                        this.apply_voies_players();
                    }
                }
            }
        }
    }

    get_winner(scores, p1, p2){
        let winner = 0;
        for (let elem in scores) {
            winner += scores[elem];
        }

        // Qui a gagné le plus de Voies
        if (winner < 0) {
            return 0;
        } else if (winner > 0) {
            return 1;
        } else {
            // Est-ce qu'un joueur a l'avantage
            if (p1.get_played_prodigy().advantaged) {
                return 0;
            } else if (p2.get_played_prodigy().advantaged) {
                return 1;
            } else {
                // Est-ce qu'un joueur a moins de pv que son opp
                if (p1.hp < p2.hp) {
                    return 0;
                } else if (p1.hp > p2.hp) {
                    return 1;
                } else {
                    // Si jamais il y a une parfaite égalité
                    return 2;
                }
            }
        }
    }

    both_players_ready(){
        for (let player of this.players){
            if (!player.ready) {
                return false;
            }
        }
        return true;
    }

    broadcast(msg) {
        this.broadcast_cmd('text_log', msg)
    }

    broadcast_cmd(cmd, data) {
        io.to(this.room).emit(cmd, data);
    }

    get_state(id) {
        let player = players[id];
        let opp = players[player.opp];
        let state = {};

        state.me = {};
        state.me.pseudo = player.pseudo;
        state.me.hand = player.hand;
        state.me.played_glyphs = player.played_glyphs;
        state.me.has_regard = player.has_regard;

        state.opp = {};
        state.opp.hand = opp.hand.length;
        state.opp.hand_hist = [1,2,3,4,5].map(x => opp.hand.map( y => y === x)
            .reduce((a,b) => a+b));
        state.opp.played_glyphs = {};
        for (let elem in opp.played_glyphs) {
            let g = opp.played_glyphs[elem];
            if (player.on_opp_regard(elem) && g !== -1) state.opp.played_glyphs[elem] = g;
            else if (g !== -1) state.opp.played_glyphs[elem] = -1;
            else state.opp.played_glyphs[elem] = -2;
        }

        let prodiges = {};
        let p;
        for (let name in player.prodiges) {
            p = player.prodiges[name];
            prodiges[p.name] = {
                'available': p.available,
                'p': p.puissance,
                'd': p.degats,
                'element': p.element
            };
        }
        if (player.played_prodigy) {
            p = prodiges[player.played_prodigy];
            p.played = true;
        }
        state.me.prodiges = prodiges;

        prodiges = {};
        for (let name in opp.prodiges) {
            p = opp.prodiges[name];
            prodiges[p.name] = {
                'available': p.available,
                'p': p.puissance,
                'd': p.degats,
                'element': p.element
            };
        }
        if (opp.played_prodigy) {
            p = prodiges[opp.played_prodigy];
            p.played = true;
        }
        state.opp.prodiges = prodiges;

        state.me.hp = player.hp;
        state.opp.hp = opp.hp;

        for (let i of ['me', 'opp']) {
            for (let status of ['protection', 'avantage', 'initiative']) {
                let p = (i === 'me') ? player : opp;
                if (p.played_prodigy) {
                    state[i][status] = p.get_played_prodigy()[status];
                }
            }
        }

        return state;
    }    

    update_front(state) {
        if (state.status !== 'done') {
            state.capacity.owner.socket.emit('capacity_resolution', {'status': state.label});
        } else {
            for (let player of this.players) {
                state.me = (state.owner === player.socket.pseudo);
                player.socket.emit('capacity_resolution', state);
            }
        }
    }

    update_lists_glyphs() {
        for (let player of this.players) {
            player.socket.emit('list_glyphs_opp', players[player.opp].hand);
        }
    }

    end_round() {
        let player;

        // Le gagnant inflige ses dégâts
        for (player of this.players) {
            if (player.winner) {
                let opp = players[player.opp];
                let prodige = player.get_played_prodigy();
                let dmg = prodige.degats;
                opp.hp -= dmg;
                console.log(prodige.name + ' inflige ' + dmg);
                let state = {
                    'status': 'done',
                    'label': 'modif_hp',
                    'value': -dmg,
                    'target': 'opp',
                    'me': true
                };
                player.socket.emit('capacity_resolution', state);
                state.me = false;
                opp.socket.emit('capacity_resolution', state);
                this.broadcast(prodige.name + ' inflige ' + dmg);
            }
        }

        let winners = [];
        for (player of this.players) {
            if (player.hp <= 0) {
                winners.push(players[player.opp].pseudo); 
            }
        }

        if (winners.length > 0) {
            for (player of this.players) {
                player.socket.emit('end_game', winners);
            }
        } else {
            console.log('Clean round ' + this.turn);
            // On clean le round et on recommence
            // Détermination du nouveau premier        
            let p0 = this.get_player_by_order(0);
            let p1 = this.get_player_by_order(1);
            if (p0.winner && p1.winner || !p0.winner) {
                p0.order = 1;
                p1.order = 0;
            }

            // On défausse les glyphes joués et on récupère les feintes
            for (let p of this.players) {
                // On enlève les prodiges joués
                p.get_played_prodigy().available = false;
                p.played_prodigy = "";
                for (let elem in p.played_glyphs) {
                    if (p.played_glyphs[elem] === 0) p.hand.push(0);
                    p.played_glyphs[elem] = -1;
                }
            }

            // Tour sup' et clean attributs
            p0.ready = false;
            p1.ready = false;
            this.scores = {};
            this.voies_players = null;
            for (let elem in this.voies) {
                this.voies[elem].capacity.target = 'owner';
            }
            this.turn++;
            // Modification de la Voie de la Terre au dernier tour
            if (this.turn === 3) this.voies.terre = this.voies_sup.terre3;
            else if (this.turn === 4) {
                let hps = this.players.map(x => x.hp);
                let winner;
                if (hps[0] !== hps[1]) {
                    winner = [this.players[hps.indexOf(Math.min.apply(null, hps))].pseudo];
                    this.broadcast_cmd('end_game', winner);
                } else {
                    this.broadcast_cmd('end_game', this.players.map(p => p.pseudo));
                }
            }

            // Update round de chaque capacité
            for (let p of this.players) {
                for (let prod in p.prodiges) {
                    p.prodiges[prod].talent.turn = this.turn;
                    p.prodiges[prod].maitrise.turn = this.turn;
                }
            }
            for (let v in this.voies) {
                this.voies[v].capacity.turn = this.turn;
            }

            // Clean front
            p0.socket.emit('clean_round');
            p1.socket.emit('clean_round');
            this.update_lists_glyphs();

            // On rentre de nouveau dans l'état d'attente
            this.state = {'label': 'wait_prodige', 'order': 0};
            this.get_player_by_order(0).socket.emit('text_log', 'Choix du Prodige');
        }
    }

    valid_effect(order, data) {
        let effects = this.voies_players[order];
        for (let e of effects) {
            if (data.element === e.element) {
                if (data.maitrise && e.maitrise || !data.maitrise) {
                    if (e.playable) return true;
                }
            }
        }
        return false;
    }
};
