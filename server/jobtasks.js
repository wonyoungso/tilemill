var Task = require('queue').Task,
    Step = require('step'),
    path = require('path'),
    Tile = require('tilelive.js').Tile,
    TileBatch = require('tilelive.js').TileBatch,
    fs = require('fs'),
    sys = require('sys'),
    settings = require('settings'),
    events = require('events');

var ExportJobMBTiles = function(model, queue) {
    var batch;
    var RenderTask = function(batch, model, queue) {
        events.EventEmitter.call(this);
        this.batch = batch;
        this.model = model;
        this.queue = queue;
        this.on('start', function() {
            this.emit('work');
        });
        this.on('work', function() {
            var that = this;
            this.batch.renderChunk(function(err, rendered) {
                if (rendered) {
                    var next = new RenderTask(that.batch, that.model, that.queue);
                    that.queue.add(next);
                    that.model.save({progress: that.batch.tiles_current / that.batch.tiles_total });
                }
                else {
                    batch.finish();
                    that.model.save({status: 'complete', progress: 1});
                }
                that.emit('finish');
            });
        });
    }
    sys.inherits(RenderTask, events.EventEmitter);

    Step(
        function() {
            path.exists(path.join(settings.export_dir, model.get('filename')), this);
        },
        function(exists) {
            if (exists) {
                var filename = model.get('filename');
                var extension = path.extname(filename);
                var date = new Date();
                var hash = require('crypto')
                    .createHash('md5')
                    .update(date.getTime())
                    .digest('hex')
                    .substring(0,6);
                model.set({
                    filename: filename.replace(extension, '') + '_' + hash + extension
                });
            }
            batch = new TileBatch({
                filepath: path.join(settings.export_dir, model.get('filename')),
                batchsize: 1,
                bbox: model.get('bbox').split(','),
                minzoom: model.get('minzoom'),
                maxzoom: model.get('maxzoom'),
                mapfile: model.get('mapfile'),
                mapfile_dir: path.join(settings.mapfile_dir),
                metadata: {
                    name: model.get('metadata_name'),
                    type: model.get('metadata_type'),
                    description: model.get('metadata_description'),
                    version: model.get('metadata_version')
                }
            });
            batch.setup(this);
        },
        function(err) {
            queue.add(new RenderTask(batch, model, queue));
            model.save({status: 'processing'});
        }
    );
}

var ExportJobImage = function(model, queue) {
    var task = new Task();
    task.on('start', function() {
        this.emit('work');
    });
    task.on('work', function() {
        Step(
            function() {
                path.exists(path.join(settings.export_dir, model.get('filename')), this);
            },
            function(exists) {
                if (exists) {
                    var filename = model.get('filename');
                    var extension = path.extname(filename);
                    var date = new Date();
                    var hash = require('crypto').createHash('md5')
                        .update(date.getTime()).digest('hex').substring(0,6);
                    model.set({
                        filename: filename.replace(extension, '') + '_' + hash + extension
                    });
                }
                var options = _.extend({}, model.attributes, {
                    scheme: 'tile',
                    format: 'png',
                    mapfile_dir: path.join(settings.mapfile_dir),
                    bbox: model.get('bbox').split(',')
                });
                try {
                    var tile = new Tile(options);
                } catch (err) {
                    model.save({
                        status: 'error',
                        error: 'Tile invalid: ' + err.message
                    });
                }
                if (tile) {
                    tile.render(this);
                }
            },
            function(err, data) {
                if (!err) {
                    fs.writeFile(path.join(settings.export_dir, model.get('filename')), data[0], function(err) {
                        if (err) {
                            model.save({
                                status: 'error',
                                error: 'Error saving image: ' + err.message
                            });
                        }
                        else {
                            model.save({
                                status:'complete',
                                progress: 1
                            });
                        }
                        task.emit('finish');
                    });
                }
                else {
                    model.save({
                        status: 'error',
                        error: 'Error rendering image: ' + err.message
                    });
                    task.emit('finish');
                }
            }
        );
    });
    queue.add(task);
    model.save({status: 'processing'});
}

module.exports = function(model, queue) {
    return {
        ExportJobImage: ExportJobImage,
        ExportJobMBTiles: ExportJobMBTiles
    }[model.get('type')](model, queue);
}