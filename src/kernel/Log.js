import { Make } from 'application-frame/util/make';
import EventTarget from 'application-frame/core/EventTarget';

let LogInterface = {
    _name : '',

    /**
     * @type LogEntry[]
     */
    _buffer : null,

    /**
     * @constructs
     * @param {string} name [description]
     * @param {LogEntry[]} buffer [description]
     * @return {void}
     */
    _make : function(name, buffer){
        this._name = name;
        this._buffer = buffer;
    },

    _add : function(type, args) {
        args.unshift(`${this._name}:`);

        console[type]('[Terminal]', ...args);

        args = args.map(item => (typeof item !== 'string') ? JSON.stringify(item) : item);

        this._buffer.push(Make({
            type : type,
            content : args.join(' ')
        }, LogEntry)());
    },

    log : function(...args){
        this._add('log', args);
    },

    error : function(...args){
        this._add('error', args);
    }
};

let LogEntry = {
    type : '',
    content : null,
};

let LogBuffer = Make({
    _buffer : null,

    _make : function(){
        EventTarget._make.apply(this);

        this._buffer = [];
    },

    push : function(item){
        this._buffer.push(item);
        this.emit('newItem', item);
        this.emit(`newItem::${item.type}`, item);
    },

    /**
     * @return {LogEntry[]}
     */
    getItems : function(){
        return this._buffer;
    }
}, EventTarget).get();

/** @type {LogBuffer} */
let systemBuffer = Make(LogBuffer)();

let Log = {
    use : function(name){
        return Make(LogInterface)(name, systemBuffer);
    },

    connect : function(fn){
        systemBuffer.on('newItem', fn);

        systemBuffer.getItems().forEach(fn);
    }
};

export default Log;
